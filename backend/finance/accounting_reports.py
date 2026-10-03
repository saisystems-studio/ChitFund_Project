"""Trial Balance / Profit & Loss / Balance Sheet -- a basic, modular
accounting layer built on the existing Group (chart of accounts) and
Ledger tables, fed by the real postings already made through Collection
Entry (`CollectionTransaction.account` / `.ledger`) and Payment Entry
(`PaymentEntry.account` / `.ledger`).

Sign convention matches the rest of the project (Ledger.opening_balance,
LedgerStatement report): a ledger's signed balance is positive for Debit,
negative for Credit.

Scope note (intentional, see the task that introduced this file): plain
loan-installment collections that don't carry an explicit "Other Charges"
ledger post only to the Cash/Bank side -- there is no per-customer
receivable ledger yet, so that money has no classified opposite leg. Doing
nothing would silently leave Trial Balance unbalanced; inventing a
plausible-looking "Sundry Debtors" figure for it would be worse (it would
look authoritative but can't be verified). Instead every report adds a
clearly labelled "Suspense Account (Unclassified)" line for exactly that
gap, same as Tally does for unreconciled postings. When loan collections
are later wired to real per-customer ledgers, that gap -- and this file's
synthetic suspense step -- shrinks to zero on its own.
"""
from decimal import Decimal

from .models import CollectionTransaction, Group, Ledger, PaymentEntry

ZERO = Decimal("0.00")
SUSPENSE_LABEL = "Suspense Account (Unclassified)"

# Ledger.group (the flat legacy classification field, still the only thing
# some older ledgers carry) predates the Group_tbl hierarchy and uses its
# own singular/combined names ('Direct Expense', 'Income', ...) that never
# matched the seeded root Group names ('Direct Expenses', 'Direct Income'
# / 'Indirect Income', ...). Without this alias, those ledgers would have
# no resolvable root and silently disappear from every report below.
# 'Income' alone can't say direct vs indirect, so it defaults to Indirect
# Income (the conventional catch-all bucket) until it is explicitly
# re-tagged via group_detail.
LEGACY_GROUP_ALIASES = {
    "Direct Expense": "Direct Expenses",
    "Indirect Expense": "Indirect Expenses",
    "Income": "Indirect Income",
}


def _group_lookup():
    return {group.id: group for group in Group.objects.all()}


def _root_of(group, groups_by_id):
    node, seen = group, {group.id}
    while node.parent_id is not None and node.parent_id not in seen:
        node = groups_by_id.get(node.parent_id)
        if node is None:
            break
        seen.add(node.id)
    return node


def _path_of(group, groups_by_id):
    """[root, ..., immediate parent, group] by walking parent_id up."""
    path, node, seen = [], group, set()
    while node is not None and node.id not in seen:
        path.append(node)
        seen.add(node.id)
        node = groups_by_id.get(node.parent_id)
    return list(reversed(path))


def ledger_balances(from_date=None, to_date=None):
    """{ledger_id: signed balance} for every real Ledger row, plus the
    unclassified (suspense) amount described in the module docstring."""
    ledgers = list(Ledger.objects.all())
    balances = {ledger.id: (ledger.opening_balance or ZERO) for ledger in ledgers}
    suspense = ZERO

    collections = CollectionTransaction.objects.all()
    if from_date:
        collections = collections.filter(collection_date__gte=from_date)
    if to_date:
        collections = collections.filter(collection_date__lte=to_date)
    for row in collections.values("account_id", "ledger_id", "collection_amount", "ledger_amount"):
        amount = row["collection_amount"] or ZERO
        ledger_amount = row["ledger_amount"] or ZERO
        if row["account_id"] in balances:
            balances[row["account_id"]] += amount
        else:
            suspense += amount
        if row["ledger_id"] in balances:
            balances[row["ledger_id"]] -= ledger_amount
        else:
            suspense -= ledger_amount
        # The part of the collection not posted to an explicit ledger (the
        # common case: a plain installment payment, no "Other Charges")
        # has no classified opposite leg yet -- see module docstring.
        suspense += ledger_amount - amount

    payments = PaymentEntry.objects.all()
    if from_date:
        payments = payments.filter(date__gte=from_date)
    if to_date:
        payments = payments.filter(date__lte=to_date)
    for row in payments.values("account_id", "ledger_id", "amount"):
        amount = row["amount"] or ZERO
        if row["account_id"] in balances:
            balances[row["account_id"]] -= amount
        else:
            suspense -= amount
        if row["ledger_id"] in balances:
            balances[row["ledger_id"]] += amount
        else:
            suspense += amount

    return ledgers, balances, suspense


def _ledger_tree(ledgers, balances, groups_by_id, natures):
    """Nest ledgers under their Group path (root -> ... -> ledger),
    grouped by root nature. Each node: {id, name, depth, is_group,
    children, debit, credit}. Ledgers with no resolvable group are
    dropped (there is always at least a legacy flat `group` string, so
    this should not normally happen)."""
    roots = {}  # root_group_id -> node
    for ledger in ledgers:
        balance = balances.get(ledger.id, ZERO)
        group = groups_by_id.get(ledger.group_detail_id) if ledger.group_detail_id else None
        if group is None:
            # Legacy ledgers (pre group_detail) only ever carry the flat
            # `group` string, which is normally a root group's name --
            # except for the handful of pre-hierarchy names aliased above.
            flat_name = LEGACY_GROUP_ALIASES.get(ledger.group, ledger.group)
            group = next((g for g in groups_by_id.values() if g.is_system and g.name == flat_name), None)
        if group is None:
            continue
        root = _root_of(group, groups_by_id)
        if root is None or natures is not None and root.nature not in natures:
            continue
        path = _path_of(group, groups_by_id)
        root_node = roots.setdefault(root.id, {"id": f"group-{root.id}", "name": root.name, "depth": 0, "is_group": True, "children": {}, "debit": ZERO, "credit": ZERO})
        node = root_node
        for depth, ancestor in enumerate(path[1:], start=1):
            node = node["children"].setdefault(ancestor.id, {"id": f"group-{ancestor.id}", "name": ancestor.name, "depth": depth, "is_group": True, "children": {}, "debit": ZERO, "credit": ZERO})
        leaf_depth = len(path)
        ledger_node = {"id": f"ledger-{ledger.id}", "name": ledger.name, "depth": leaf_depth, "is_group": False, "children": {}, "debit": max(balance, ZERO), "credit": max(-balance, ZERO)}
        node["children"][f"ledger-{ledger.id}"] = ledger_node

    def finalize(node):
        children = sorted(node["children"].values(), key=lambda item: item["name"])
        node["children"] = [finalize(child) for child in children]
        if node["is_group"]:
            node["debit"] = sum((child["debit"] for child in node["children"]), ZERO)
            node["credit"] = sum((child["credit"] for child in node["children"]), ZERO)
        return node

    return [finalize(node) for node in sorted(roots.values(), key=lambda item: item["name"])]


def trial_balance(from_date=None, to_date=None):
    ledgers, balances, suspense = ledger_balances(from_date, to_date)
    groups_by_id = _group_lookup()
    groups = _ledger_tree(ledgers, balances, groups_by_id, natures=None)
    total_debit = sum((group["debit"] for group in groups), ZERO)
    total_credit = sum((group["credit"] for group in groups), ZERO)
    if suspense:
        groups.append({"id": "suspense", "name": SUSPENSE_LABEL, "depth": 0, "is_group": True, "children": [], "debit": max(suspense, ZERO), "credit": max(-suspense, ZERO)})
        total_debit += max(suspense, ZERO)
        total_credit += max(-suspense, ZERO)
    return {"groups": groups, "total_debit": total_debit, "total_credit": total_credit}


def profit_and_loss(from_date=None, to_date=None):
    """Income/Expense ledgers' movement in the period only -- nominal
    accounts don't carry an opening balance forward into a new report."""
    ledgers, balances_with_opening, _suspense = ledger_balances(from_date, to_date)
    opening_only = {ledger.id: (ledger.opening_balance or ZERO) for ledger in ledgers}
    movement = {ledger_id: balances_with_opening[ledger_id] - opening_only[ledger_id] for ledger_id in balances_with_opening}
    groups_by_id = _group_lookup()
    expense_groups = _ledger_tree(ledgers, movement, groups_by_id, natures={"EXPENSE"})
    income_groups = _ledger_tree(ledgers, movement, groups_by_id, natures={"INCOME"})

    def split(groups, direct_name):
        direct = next((group for group in groups if group["name"] == direct_name), None)
        indirect = [group for group in groups if group["name"] != direct_name]
        return direct, indirect

    direct_expense, indirect_expense = split(expense_groups, "Direct Expenses")
    direct_income, indirect_income = split(income_groups, "Direct Income")
    direct_expense_total = direct_expense["debit"] - direct_expense["credit"] if direct_expense else ZERO
    direct_income_total = direct_income["credit"] - direct_income["debit"] if direct_income else ZERO
    indirect_expense_total = sum((g["debit"] - g["credit"] for g in indirect_expense), ZERO)
    indirect_income_total = sum((g["credit"] - g["debit"] for g in indirect_income), ZERO)
    gross_profit = direct_income_total - direct_expense_total
    net_profit = gross_profit + indirect_income_total - indirect_expense_total
    return {
        "direct_expense": direct_expense, "indirect_expense": indirect_expense,
        "direct_income": direct_income, "indirect_income": indirect_income,
        "gross_profit": gross_profit, "net_profit": net_profit,
    }


def balance_sheet(from_date=None, to_date=None):
    ledgers, balances, suspense = ledger_balances(from_date, to_date)
    groups_by_id = _group_lookup()
    asset_groups = _ledger_tree(ledgers, balances, groups_by_id, natures={"ASSET"})
    liability_groups = _ledger_tree(ledgers, balances, groups_by_id, natures={"LIABILITY"})
    total_assets = sum((group["debit"] - group["credit"] for group in asset_groups), ZERO)
    total_liabilities = sum((group["credit"] - group["debit"] for group in liability_groups), ZERO)
    net_profit = profit_and_loss(from_date, to_date)["net_profit"]
    # Net profit increases what the business owns relative to what it
    # owes (retained earnings); a loss does the reverse. Shown on
    # whichever side keeps both totals non-negative and balanced.
    if net_profit >= 0:
        total_liabilities += net_profit
    else:
        total_assets += -net_profit
    if suspense:
        if suspense >= 0:
            total_assets += suspense
        else:
            total_liabilities += -suspense
    return {
        "assets": asset_groups, "liabilities": liability_groups,
        "net_profit": net_profit, "suspense": suspense,
        "total_assets": total_assets, "total_liabilities": total_liabilities,
    }
