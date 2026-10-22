from datetime import date
from django.db.models import Q
from rest_framework import serializers
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import BankTransfer
from .views import FinanceViewSet

class BankTransferSerializer(serializers.ModelSerializer):
    voucher_no = serializers.CharField(read_only=True)
    from_account_name = serializers.CharField(source='from_account.name',read_only=True)
    to_account_name = serializers.CharField(source='to_account.name',read_only=True)
    transaction_type_display = serializers.CharField(source='get_transaction_type_display',read_only=True)
    payment_mode_display = serializers.CharField(source='get_payment_mode_display',read_only=True)
    class Meta:
        model=BankTransfer
        fields='__all__'
        read_only_fields=('created_by','modified_by')

    def validate(self,attrs):
        current=lambda key:attrs.get(key,getattr(self.instance,key,None))
        kind=current('transaction_type')
        source,target=current('from_account'),current('to_account')
        amount=current('amount')
        errors={}
        if amount is not None and (not amount.is_finite() or amount <= 0):
            errors['amount']='Enter an amount greater than zero.'
        expected=BankTransfer.DIRECTIONS.get(kind)
        if expected:
            for key,account,group in zip(('from_account','to_account'),(source,target),expected):
                if account and account.group != group: errors[key]=f'Select a {group} ledger.'
        if source and target and source.pk==target.pk: errors['to_account']='From and To accounts must differ.'
        # Payment Mode is required on new transfers and whenever it or the type is changed;
        # transfers saved before it existed keep their blank mode on unrelated edits.
        mode=current('payment_mode') or ''
        if self.instance is None or 'payment_mode' in attrs or 'transaction_type' in attrs:
            if not mode: errors['payment_mode']='Select a Payment Mode.'
            elif kind in BankTransfer.MODES and mode not in BankTransfer.MODES[kind]:
                errors['payment_mode']='Select a Payment Mode allowed for '+dict(BankTransfer.TYPES)[kind]+'.'
        if errors: raise serializers.ValidationError(errors)
        return attrs

class BankTransferViewSet(FinanceViewSet):
    queryset=BankTransfer.objects.select_related('from_account','to_account').all()
    serializer_class=BankTransferSerializer
    delete_label='bank transfer'

    def get_queryset(self):
        rows=super().get_queryset()
        params=self.request.query_params
        kind=params.get('transaction_type')
        if kind:
            if kind not in dict(BankTransfer.TYPES): raise serializers.ValidationError({'transaction_type':'Select a valid transaction type.'})
            rows=rows.filter(transaction_type=kind)
        search=params.get('search','').strip()
        if search:
            query=Q(from_account__name__icontains=search)|Q(to_account__name__icontains=search)|Q(reference_no__icontains=search)|Q(notes__icontains=search)|Q(payment_mode__icontains=search)
            if search.upper().startswith('BT-') and search[3:].isdigit(): query |= Q(pk=int(search[3:]))
            rows=rows.filter(query)
        try:
            start=date.fromisoformat(params['from']) if params.get('from') else None
            end=date.fromisoformat(params['to']) if params.get('to') else None
            if start and end and start>end: raise ValueError()
        except ValueError: raise serializers.ValidationError({'date':'Enter a valid From/To date range.'})
        if start: rows=rows.filter(date__gte=start)
        if end: rows=rows.filter(date__lte=end)
        return rows

    @action(detail=False,methods=['get'],url_path='next-voucher')
    def next_voucher(self,request):
        return Response({'voucher_no':BankTransfer.next_voucher_no()})

    def perform_create(self,serializer):
        serializer.save(created_by=self.request.user.get_username())

    def perform_update(self,serializer):
        serializer.save(modified_by=self.request.user.get_username())
