from calendar import monthrange
from datetime import date, timedelta
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
from django.db import models, transaction
from .models import HolidayMaster, CustomerLoanInstallmentDetails


@transaction.atomic
def next_document_number(loan_type):
    from .models import LoanDocumentSequence, CustomerLoanDetails
    prefix = {'chit': 'CH', 'interest': 'IN', 'mortgage': 'M'}.get(loan_type.name.strip().lower(), f'L{loan_type.pk}')
    LoanDocumentSequence.objects.get_or_create(prefix=prefix)
    sequence = LoanDocumentSequence.objects.select_for_update().get(prefix=prefix)
    while True:
        sequence.last_value += 1
        number = f'{prefix}-{sequence.last_value:04d}'
        if not CustomerLoanDetails.objects.filter(models.Q(doc_no=number) | models.Q(loan_no=number)).exists():
            break
    sequence.save(update_fields=['last_value'])
    return number


def record_mortgage_history(loan, user, action):
    from .models import MortgageLoanHistory
    mortgage = loan.mortgage_details
    snapshot = {field: (str(getattr(mortgage, field)) if getattr(mortgage, field) is not None else None)
                for field in ('product_id', 'product_name', 'unit', 'quantity', 'current_rate',
                              'market_value', 'loan_amount', 'interest_percentage', 'daily_interest_amount')}
    snapshot.update(customer_id=loan.customer_id, customer_name=loan.customer.full_name,
                    loan_no=loan.loan_no, application_date=str(loan.application_date),
                    start_date=str(loan.loan_start_date), total_amount=str(loan.total_amount))
    MortgageLoanHistory.objects.create(loan=loan, doc_no=loan.doc_no, customer_name=loan.customer.full_name,
                                      action=action, recorded_by=getattr(user, 'username', ''), snapshot=snapshot)
def money(value): return Decimal(value).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
def add_months(date, months):
    month = date.month - 1 + months
    year, month = date.year + month // 12, month % 12 + 1
    return date.replace(year=year, month=month, day=min(date.day, monthrange(year, month)[1]))


@dataclass(frozen=True)
class ChitScheduleRow:
    installment_number: int
    due_date: date


def _month_date(year, month, day):
    """Return a valid date, clamping 29/30/31 to the month's last day."""
    return date(year, month, min(day, monthrange(year, month)[1]))


def _shift_to_valid(candidate, include_sunday, holidays, previous):
    """Shift forward without ever dropping an installment or duplicating a date."""
    current = max(candidate, (previous + timedelta(days=1)) if previous else candidate)
    while (current.weekday() == 6 and not include_sunday) or current in holidays:
        current += timedelta(days=1)
    return current


def is_collection_working_day(day, customer_loan, chit_details, holiday_settings=()):
    """Apply the loan-specific Sunday and holiday rules in one place."""
    settings = {item.holiday.holiday_date: item.include_in_schedule for item in holiday_settings}
    # A per-loan explicit include always wins, including for Sundays.
    if settings.get(day) is True:
        return True
    if day.weekday() == 6:
        return bool(chit_details.include_sunday)
    holiday = HolidayMaster.objects.filter(holiday_date=day, is_active=True).first()
    return holiday is None


def generate_chit_schedule(start_date, duration, duration_type, collection_day=None,
                           collection_month=None, include_sunday=False, holidays=None):
    """Generate the authoritative customer due dates.

    ``holidays`` is an iterable of dates that are *not* allowed.  This keeps
    government holiday selection explicit: only dates selected by the caller
    are skipped.  The result always contains exactly ``duration`` rows.
    """
    if duration <= 0:
        raise ValueError("duration must be greater than zero")
    if not isinstance(start_date, date):
        raise TypeError("start_date must be a datetime.date")
    kind = str(duration_type).upper()
    blocked = set(holidays or ())
    candidates = []
    if kind in ("DAY", "DAYS", "DAILY"):
        candidates = [start_date + timedelta(days=index) for index in range(duration)]
    elif kind in ("MONTH", "MONTHS", "MONTHLY"):
        if collection_day is None or not 1 <= int(collection_day) <= 31:
            raise ValueError("collection_day must be between 1 and 31")
        # Use the first configured collection day on/after the start date.
        offset = 0 if int(collection_day) >= start_date.day else 1
        for index in range(duration):
            cursor = add_months(start_date.replace(day=1), offset + index)
            candidates.append(_month_date(cursor.year, cursor.month, int(collection_day)))
    elif kind in ("YEAR", "YEARS", "YEARLY", "ANNUAL", "ANNUALLY"):
        if collection_month is None or not 1 <= int(collection_month) <= 12:
            raise ValueError("collection_month must be between 1 and 12")
        if collection_day is None or not 1 <= int(collection_day) <= 31:
            raise ValueError("collection_day must be between 1 and 31")
        first_year = start_date.year
        first = _month_date(first_year, int(collection_month), int(collection_day))
        if first < start_date:
            first_year += 1
        for index in range(duration):
            candidates.append(_month_date(first_year + index, int(collection_month), int(collection_day)))
    else:
        raise ValueError("duration_type must be DAY, MONTH, or YEAR")

    rows, previous = [], None
    for number, candidate in enumerate(candidates, 1):
        due = _shift_to_valid(candidate, include_sunday, blocked, previous)
        rows.append(ChitScheduleRow(number, due))
        previous = due
    return rows


@transaction.atomic
def save_installments_preserving_payments(loan, rows):
    from rest_framework.exceptions import ValidationError
    existing = {row.installment_number: row for row in loan.installment_details.select_for_update()}
    numbers = {row.installment_number for row in rows}
    for number, old in existing.items():
        if number not in numbers:
            if old.paid_amount or old.penalty_amount or old.collection_transactions.exists():
                raise ValidationError({"detail": "Cannot remove an installment with recorded payments or penalties."})
            old.delete()
    saved = []
    for row in rows:
        old = existing.get(row.installment_number)
        if old:
            if row.installment_amount + old.penalty_amount < old.paid_amount:
                raise ValidationError({"detail": "Installment amount cannot be reduced below its recorded payments."})
            old.due_date = row.due_date
            old.installment_amount = row.installment_amount
            old.outstanding_amount = max(Decimal("0.00"), row.installment_amount + old.penalty_amount - old.paid_amount)
            old.save(update_fields=("due_date", "installment_amount", "outstanding_amount", "modified_date"))
            saved.append(old)
        else:
            row.save()
            saved.append(row)
    return saved


def generate_customer_chit_installments(loan, chit_details, holiday_settings=()):
    """Recalculate and persist a customer's copied schedule in one transaction."""
    group = chit_details.chit_group
    holiday_settings = list(holiday_settings)
    settings = {setting.holiday_id: setting.include_in_schedule for setting in holiday_settings}
    active_holidays = HolidayMaster.objects.filter(is_active=True)
    blocked = set()
    for holiday in active_holidays:
        if settings.get(holiday.id, False):
            continue
        # IncludeSunday applies to every Sunday, even if it is also listed in
        # HolidayMaster as a Sunday/custom/government holiday.
        if holiday.holiday_date.weekday() == 6 and chit_details.include_sunday:
            continue
        blocked.add(holiday.holiday_date)
    horizon = loan.loan_start_date + timedelta(days=(group.duration * 3 if group.duration_type == "DAY" else group.duration * 366))
    cursor = loan.loan_start_date
    while cursor <= horizon:
        if cursor.weekday() == 6 and not chit_details.include_sunday and cursor not in {
            setting.holiday.holiday_date for setting in holiday_settings if setting.include_in_schedule
        }:
            blocked.add(cursor)
        cursor += timedelta(days=1)
    allowed_sundays = {setting.holiday.holiday_date for setting in holiday_settings if setting.include_in_schedule and setting.holiday.holiday_date.weekday() == 6}
    blocked.difference_update(allowed_sundays)
    rows = generate_chit_schedule(
        loan.loan_start_date, group.duration, group.duration_type,
        collection_day=group.collection_day, collection_month=group.collection_month,
        include_sunday=True, holidays=blocked,
    )
    templates = list(group.installments.order_by("installment_number"))
    if len(templates) != group.duration:
        raise ValueError("Chit group installment template count must equal duration")
    with transaction.atomic():
        from .models import CustomerLoanInstallmentDetails
        created = [CustomerLoanInstallmentDetails(
            loan=loan, installment_number=row.installment_number, due_date=row.due_date,
            installment_amount=templates[row.installment_number - 1].installment_amount,
            paid_amount=Decimal("0.00"), penalty_amount=Decimal("0.00"),
            outstanding_amount=templates[row.installment_number - 1].installment_amount,
        ) for row in rows]
        created = save_installments_preserving_payments(loan, created)
        loan.loan_end_date = rows[-1].due_date
        loan.total_amount = sum((item.installment_amount for item in created), Decimal("0.00"))
        loan.outstanding_amount = loan.total_amount - loan.paid_amount + loan.penalty_amount
        loan.save(update_fields=("loan_end_date", "total_amount", "outstanding_amount", "modified_date"))
    return created


def generate_customer_interest_installments(loan, interest, include_sunday=False):
    """Persist the flat-interest schedule without changing the Chit schedule path."""
    kind = interest.loan_installment.name
    if kind in ("Daily", "100 Days"):
        rows = [ChitScheduleRow(index + 1, interest.start_date + timedelta(days=index)) for index in range(interest.installment_count)]
    elif kind == "Weekly":
        first = interest.start_date + timedelta(days=((interest.collection_day - interest.start_date.weekday()) % 7))
        rows = [ChitScheduleRow(index + 1, first + timedelta(days=index * 7)) for index in range(interest.installment_count)]
    elif kind in ("Annual", "Other", "Others"):
        first_year = interest.start_date.year
        first = _month_date(first_year, interest.collection_month, interest.collection_date.day)
        if first < interest.start_date:
            first_year += 1
        rows = [ChitScheduleRow(index + 1, _month_date(first_year + index, interest.collection_month, interest.collection_date.day)) for index in range(interest.installment_count)]
    else:
        rows = [ChitScheduleRow(index + 1, _month_date((interest.start_date.replace(day=1) + timedelta(days=32 * index)).year, (interest.start_date.month + index - 1) % 12 + 1, interest.collection_date.day)) for index in range(interest.installment_count)]
    unit = Decimal(str(interest.installment_amount))
    total = Decimal(str(interest.total_payable_amount))
    created = [CustomerLoanInstallmentDetails(
        loan=loan, installment_number=row.installment_number, due_date=row.due_date,
        installment_amount=(total - unit * (interest.installment_count - 1)) if row.installment_number == interest.installment_count else unit,
        paid_amount=Decimal("0.00"), penalty_amount=Decimal("0.00"),
        outstanding_amount=(total - unit * (interest.installment_count - 1)) if row.installment_number == interest.installment_count else unit,
    ) for row in rows]
    created = save_installments_preserving_payments(loan, created)
    loan.loan_end_date = rows[-1].due_date
    loan.total_amount = total
    loan.outstanding_amount = max(Decimal("0.00"), total + loan.penalty_amount - loan.paid_amount)
    loan.save(update_fields=("loan_end_date", "total_amount", "outstanding_amount", "modified_date"))
    return created


def generate_customer_mortgage_installment(loan, mortgage):
    total = money(Decimal(str(mortgage.loan_amount)) + Decimal(str(mortgage.daily_interest_amount)))
    due_date = loan.loan_start_date + timedelta(days=1)
    row = CustomerLoanInstallmentDetails(
        loan=loan,
        installment_number=1,
        due_date=due_date,
        installment_amount=total,
        paid_amount=Decimal("0.00"),
        penalty_amount=Decimal("0.00"),
        outstanding_amount=total,
    )
    row = save_installments_preserving_payments(loan, [row])[0]
    loan.loan_end_date = due_date
    loan.total_amount = total
    loan.outstanding_amount = max(Decimal("0.00"), total + loan.penalty_amount - loan.paid_amount)
    loan.save(update_fields=("loan_end_date", "total_amount", "outstanding_amount", "modified_date"))
    return [row]
