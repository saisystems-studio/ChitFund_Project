from decimal import Decimal

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from customers.models import Customer
from .accounting_reports import balance_sheet, profit_and_loss, trial_balance
from .models import ChitGroup, ChitGroupInstallmentDetail, CollectionTransaction, CustomerLoanDetails, Group, Ledger, LoanInstallment, LoanType, PaymentEntry


class AccountingReportsTests(TestCase):
    def setUp(self):
        # These roots already exist from the 0026 data migration (it runs
        # against the test DB too); fetch rather than re-create them, and
        # make sure their nature is what this test expects.
        def root(name, nature):
            group, _ = Group.objects.get_or_create(parent=None, name=name, defaults={"is_system": True, "is_active": True, "nature": nature})
            if group.nature != nature:
                group.nature = nature
                group.save(update_fields=["nature"])
            return group

        self.cash_root = root("Cash-in-Hand", "ASSET")
        self.bank_root = root("Bank Accounts", "ASSET")
        self.liability_root = root("Loans (Liability)", "LIABILITY")
        self.expense_root = root("Indirect Expenses", "EXPENSE")
        self.income_root = root("Direct Income", "INCOME")

        self.cash = Ledger.objects.create(name="Cash", group="Cash-in-Hand", group_detail=self.cash_root, opening_balance=Decimal("1000.00"))
        self.bank = Ledger.objects.create(name="Bank", group="Bank Accounts", opening_balance=Decimal("500.00"))
        self.owner_loan = Ledger.objects.create(name="Owner Loan", group="Loans (Liability)", group_detail=self.liability_root, opening_balance=Decimal("-1500.00"))
        self.rent = Ledger.objects.create(name="Rent Expense", group="Indirect Expenses", group_detail=self.expense_root, opening_balance=Decimal("0.00"))
        self.interest_income = Ledger.objects.create(name="Interest Income", group="Direct Income", group_detail=self.income_root, opening_balance=Decimal("0.00"))

        customer = Customer.objects.create(customer_code="ACC010", full_name="Report Customer", primary_mobile="9876500010", role="BORROWER")
        loan_type = LoanType.objects.get_or_create(name="Chit")[0]
        LoanInstallment.objects.get_or_create(name="Daily", defaults={"code": "DAILY"})
        group = ChitGroup.objects.create(code="RPT", name="Report Group", duration=2, duration_type="DAY")
        for number in (1, 2):
            ChitGroupInstallmentDetail.objects.create(group=group, installment_number=number, schedule_value=str(number), installment_amount=2500)
        loan = CustomerLoanDetails.objects.create(customer=customer, loan_type=loan_type, loan_amount=300, loan_start_date="2025-01-01",
                                                   total_amount=300, paid_amount=0, penalty_amount=0, outstanding_amount=300)
        from .models import CustomerLoanInstallmentDetails
        installment = CustomerLoanInstallmentDetails.objects.create(loan=loan, installment_number=1, due_date="2025-01-01",
                                                                      installment_amount=300, paid_amount=0, penalty_amount=0,
                                                                      outstanding_amount=300, payment_status="PENDING")

        # 300 collected into Cash; only 50 of it is explicitly ledgered
        # (as Interest Income) -- the remaining 250 is a plain installment
        # payment with no classified opposite leg (see accounting_reports
        # module docstring for why that becomes Suspense, not a guess).
        CollectionTransaction.objects.create(installment=installment, loan=loan, customer=customer,
                                              collection_amount=Decimal("300.00"), collection_date="2025-01-02",
                                              account=self.cash, ledger=self.interest_income, ledger_group="Income",
                                              ledger_amount=Decimal("50.00"))
        # 120 paid out of Bank against Rent Expense.
        PaymentEntry.objects.create(account=self.bank, ledger=self.rent, amount=Decimal("120.00"),
                                     payment_mode="Cash", date="2025-01-03")

    def test_trial_balance_balances(self):
        report = trial_balance()
        self.assertEqual(report["total_debit"], report["total_credit"])
        self.assertEqual(report["total_debit"], Decimal("1800.00"))
        suspense = next(g for g in report["groups"] if g["name"] == "Suspense Account (Unclassified)")
        self.assertEqual(suspense["credit"], Decimal("250.00"))

    def test_profit_and_loss(self):
        report = profit_and_loss()
        self.assertEqual(report["gross_profit"], Decimal("50.00"))
        self.assertEqual(report["net_profit"], Decimal("-70.00"))

    def test_balance_sheet_balances(self):
        report = balance_sheet()
        self.assertEqual(report["total_assets"], report["total_liabilities"])
        self.assertEqual(report["total_assets"], Decimal("1750.00"))
        self.assertEqual(report["net_profit"], Decimal("-70.00"))
        self.assertEqual(report["suspense"], Decimal("-250.00"))

    def test_legacy_flat_group_without_group_detail_still_resolves(self):
        # Bank has no group_detail (legacy flat group only); it must still
        # resolve to the "Bank Accounts" root by exact name match, carrying
        # its real balance (500 opening - 120 paid out = 380 Dr) into the
        # report instead of silently vanishing.
        report = trial_balance()
        bank_group = next(g for g in report["groups"] if g["name"] == "Bank Accounts")
        self.assertEqual(bank_group["debit"], Decimal("380.00"))
        self.assertEqual(bank_group["children"][0]["name"], "Bank")

    def test_api_endpoints_respond(self):
        client = APIClient()
        client.force_authenticate(User.objects.create_user("accounting-report-admin", is_staff=True))
        trial = client.get("/api/finance/reports/trial-balance/")
        self.assertEqual(trial.status_code, 200, trial.data)
        self.assertEqual(Decimal(trial.data["total_debit"]), Decimal(trial.data["total_credit"]))
        pl = client.get("/api/finance/reports/profit-loss/")
        self.assertEqual(pl.status_code, 200, pl.data)
        self.assertIn("net_profit", pl.data)
        bs = client.get("/api/finance/reports/balance-sheet/")
        self.assertEqual(bs.status_code, 200, bs.data)
        self.assertEqual(Decimal(bs.data["total_assets"]), Decimal(bs.data["total_liabilities"]))
        trial_ranged = client.get("/api/finance/reports/trial-balance/", {"from": "2025-01-01", "to": "2025-01-31"})
        self.assertEqual(trial_ranged.status_code, 200, trial_ranged.data)

    def test_missing_transfer_table_keeps_reports_available_with_warning(self):
        from unittest.mock import patch
        client = APIClient()
        client.force_authenticate(User(is_staff=True))
        with patch("django.db.backends.sqlite3.introspection.DatabaseIntrospection.table_names", return_value=[]):
            for name, params in [("ledger", {"type": "cash"}), ("ledger", {"type": "bank"}), ("trial-balance", {}), ("profit-loss", {}), ("balance-sheet", {})]:
                response = client.get(f"/api/finance/reports/{name}/", params)
                self.assertEqual(response.status_code, 200)
                self.assertIn("not been deployed", response.data["warnings"][0])

    def test_invalid_and_reversed_dates_are_400(self):
        client = APIClient()
        client.force_authenticate(User(is_staff=True))
        for name in ["ledger", "trial-balance", "profit-loss", "balance-sheet"]:
            for params in [{"from": "invalid"}, {"from": "2025-02-01", "to": "2025-01-01"}]:
                response = client.get(f"/api/finance/reports/{name}/", {"type": "cash", **params})
                self.assertEqual(response.status_code, 400)

    def test_transfers_post_both_sides_and_range_opening(self):
        from .models import BankTransfer
        BankTransfer.objects.create(date="2025-01-02", transaction_type="DEPOSIT", from_account=self.cash, to_account=self.bank, amount=Decimal("200"))
        BankTransfer.objects.create(date="2025-01-03", transaction_type="WITHDRAWAL", from_account=self.bank, to_account=self.cash, amount=Decimal("50"))
        client = APIClient()
        client.force_authenticate(User(is_staff=True))
        response = client.get("/api/finance/reports/ledger/", {"type": "bank", "from": "2025-01-03", "to": "2025-01-03"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["total_credit"], Decimal("170"))
        self.assertEqual(response.data["closing_balance"], response.data["opening_balance"] - Decimal("170"))
        self.assertEqual(trial_balance()["total_debit"], trial_balance()["total_credit"])
        self.assertEqual(balance_sheet()["total_assets"], balance_sheet()["total_liabilities"])

    def test_empty_reports_return_200(self):
        client = APIClient()
        client.force_authenticate(User(is_staff=True))
        for name in ["ledger", "trial-balance", "profit-loss", "balance-sheet", "day-wise", "loan-wise"]:
            response = client.get(f"/api/finance/reports/{name}/", {"type": "bank", "from": "2099-01-01", "to": "2099-01-02"})
            self.assertEqual(response.status_code, 200)

    def test_null_transfer_amount_is_zero(self):
        from unittest.mock import Mock, patch
        from .accounting_reports import ledger_balances
        query = Mock()
        query.values.return_value = [{"from_account_id": self.cash.id, "to_account_id": self.bank.id, "amount": None}]
        before = ledger_balances()[1]
        with patch("finance.accounting_reports.bank_transfer_queryset", return_value=query):
            self.assertEqual(ledger_balances()[1], before)

    def test_bank_subgroup_included_in_statement(self):
        subgroup = Group.objects.create(name="Branch Banks", parent=self.bank_root, nature="ASSET")
        Ledger.objects.create(name="Branch Account", group="", group_detail=subgroup, opening_balance=Decimal("75"))
        client = APIClient()
        client.force_authenticate(User(is_staff=True))
        response = client.get("/api/finance/reports/ledger/", {"type": "bank"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["opening_balance"], Decimal("575"))
