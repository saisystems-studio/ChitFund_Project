"""Edits reverse only the selected receipt before applying its replacement."""
from decimal import Decimal

from django.db import transaction
from django.db.models import Max, Sum
from django.utils import timezone
from rest_framework import serializers, mixins, viewsets
from rest_framework.response import Response

from accounts.permissions import CanWriteFinanceData
from .models import CollectionAllocation, CollectionTransaction, CustomerLoanDetails, PaymentEntry

ZERO = Decimal('0.00')


class CollectionAllocationSerializer(serializers.ModelSerializer):
    installment_id = serializers.IntegerField(read_only=True)
    installment_number = serializers.IntegerField(source='installment.installment_number', read_only=True)

    class Meta:
        model = CollectionAllocation
        fields = ('installment_id', 'installment_number', 'amount')


class CollectionTransactionSerializer(serializers.ModelSerializer):
    customer_name = serializers.CharField(source='customer.full_name', read_only=True)
    loan_no = serializers.CharField(source='loan.loan_no', read_only=True)
    allocations = CollectionAllocationSerializer(many=True, read_only=True)

    class Meta:
        model = CollectionTransaction
        fields = '__all__'
        read_only_fields = ('customer', 'loan', 'installment', 'created_by', 'modified_by')

    def validate(self, attrs):
        current = lambda key: attrs.get(key, getattr(self.instance, key, None))
        errors = {}
        for key in ('collection_amount', 'adjustment_amount', 'discount_amount', 'ledger_amount'):
            value = current(key)
            if value is not None and (not value.is_finite() or value < 0 or (key == 'collection_amount' and value == 0)):
                errors[key] = 'Enter a positive amount.' if key == 'collection_amount' else 'Enter a nonnegative amount.'
        mode = current('payment_mode')
        if mode not in dict(PaymentEntry.PAYMENT_MODES):
            errors['payment_mode'] = 'Select a valid payment mode.'
        required = {'UPI': ('upi_id', 'reference_no'), 'Cheque': ('cheque_number', 'cheque_date', 'bank_name'), 'NEFT': ('reference_no', 'bank_name')}.get(mode, ())
        for key in required:
            if not current(key):
                errors[key] = 'This field is required.'
        account, ledger, group = current('account'), current('ledger'), current('ledger_group')
        if account and account.group not in PaymentEntry.ACCOUNT_GROUPS:
            errors['account'] = 'Select a Cash or Bank account.'
        if ledger and (ledger.group not in dict(CollectionTransaction.LEDGER_GROUPS) or (group and group != ledger.group)):
            errors['ledger'] = 'Select a Ledger matching the selected group.'
        if ledger and not group:
            attrs['ledger_group'] = group = ledger.group
        if current('ledger_amount') and not group:
            errors['ledger_group'] = 'Select a Ledger for the Ledger Amount.'
        if errors:
            raise serializers.ValidationError(errors)
        return attrs


def reverse_collection(receipt, rows):
    by_id = {row.pk: row for row in rows}
    splits = list(receipt.allocations.all())
    if not splits:
        # Only a single-installment loan has an unambiguous legacy split.
        row = by_id.get(receipt.installment_id)
        other_legacy = receipt.loan.collection_transactions.exclude(pk=receipt.pk).filter(allocations__isnull=True).exists()
        recorded = row.collection_allocations.aggregate(total=Sum('amount'))['total'] or ZERO
        if len(rows) != 1 or other_legacy or row.paid_amount - recorded < receipt.collection_amount:
            raise serializers.ValidationError({'detail': 'This older collection has no reliable installment allocation. Reconcile its allocation history before editing or deleting it.'})
        splits = [CollectionAllocation(installment=row, amount=receipt.collection_amount)]
    for split in splits:
        row = by_id.get(split.installment_id)
        if row is None or split.amount <= 0 or row.paid_amount < split.amount:
            raise serializers.ValidationError({'detail': 'The saved allocation does not match the installment balance. Reconcile this collection before changing it.'})
        row.paid_amount -= split.amount
    first = by_id[receipt.installment_id]
    if first.penalty_amount < receipt.adjustment_amount:
        raise serializers.ValidationError({'detail': 'The saved adjustment does not match the installment balance.'})
    first.penalty_amount -= receipt.adjustment_amount
    receipt.allocations.all().delete()


def refresh_balances(loan, rows):
    for row in rows:
        row.outstanding_amount = max(ZERO, row.installment_amount + row.penalty_amount - row.paid_amount)
        row.payment_status = 'PAID' if row.outstanding_amount <= 0 else 'PARTIAL' if row.paid_amount > 0 else 'OVERDUE' if row.due_date < timezone.localdate() else 'PENDING'
        if row.paid_amount <= 0:
            row.paid_date = None
        else:
            dates = list(row.collection_allocations.values_list('transaction__collection_date', flat=True))
            dates += list(row.collection_transactions.filter(allocations__isnull=True).values_list('collection_date', flat=True))
            if dates:
                row.paid_date = max(dates)
        row.save(update_fields=('paid_amount', 'penalty_amount', 'outstanding_amount', 'payment_status', 'paid_date', 'modified_date'))
    loan.total_amount = sum((row.installment_amount for row in rows), ZERO)
    loan.paid_amount = sum((row.paid_amount for row in rows), ZERO)
    loan.penalty_amount = sum((row.penalty_amount for row in rows), ZERO)
    loan.outstanding_amount = max(ZERO, loan.total_amount + loan.penalty_amount - loan.paid_amount)
    loan.loan_status = 'COMPLETED' if loan.outstanding_amount <= 0 else 'ACTIVE'
    loan.is_active = loan.outstanding_amount > 0
    loan.save(update_fields=('total_amount', 'paid_amount', 'penalty_amount', 'outstanding_amount', 'loan_status', 'is_active', 'modified_date'))


class CollectionTransactionViewSet(mixins.RetrieveModelMixin, mixins.UpdateModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet):
    permission_classes = [CanWriteFinanceData]
    serializer_class = CollectionTransactionSerializer
    queryset = CollectionTransaction.objects.select_related('customer', 'loan').prefetch_related('allocations__installment')
    http_method_names = ['get', 'patch', 'delete', 'head', 'options']

    def locked_receipt(self):
        obj = self.get_object()
        loan = CustomerLoanDetails.objects.select_for_update().get(pk=obj.loan_id)
        receipt = CollectionTransaction.objects.select_for_update().get(pk=obj.pk)
        rows = list(loan.installment_details.select_for_update().order_by('due_date', 'installment_number'))
        return receipt, loan, rows

    @transaction.atomic
    def update(self, request, *args, **kwargs):
        receipt, loan, rows = self.locked_receipt()
        serializer = self.get_serializer(receipt, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        reverse_collection(receipt, rows)
        data = serializer.validated_data
        amount = data.get('collection_amount', receipt.collection_amount)
        penalty = data.get('adjustment_amount', receipt.adjustment_amount)
        discount = data.get('discount_amount', receipt.discount_amount)
        available = sum((max(ZERO, row.installment_amount - row.paid_amount) for row in rows), ZERO)
        if amount > available + penalty - discount:
            raise serializers.ValidationError({'collection_amount': 'Amount exceeds the remaining loan outstanding.'})
        remaining, splits = amount, []
        for row in rows:
            applied = min(max(ZERO, row.installment_amount - row.paid_amount), remaining)
            if applied > 0:
                row.paid_amount += applied
                remaining -= applied
                splits.append((row, applied))
        if not splits:
            raise serializers.ValidationError({'collection_amount': 'No installment balance is available for this collection.'})
        first = splits[0][0]
        first.penalty_amount += penalty
        receipt = serializer.save(installment=first, modified_by=request.user.get_username())
        CollectionAllocation.objects.bulk_create([CollectionAllocation(transaction=receipt, installment=row, amount=applied) for row, applied in splits])
        refresh_balances(loan, rows)
        return Response(self.get_serializer(receipt).data)

    @transaction.atomic
    def destroy(self, request, *args, **kwargs):
        receipt, loan, rows = self.locked_receipt()
        reverse_collection(receipt, rows)
        receipt.delete()
        refresh_balances(loan, rows)
        return Response(status=204)
