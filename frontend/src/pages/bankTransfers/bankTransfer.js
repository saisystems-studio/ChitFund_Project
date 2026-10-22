export const ENDPOINT = "/finance/bank-transfers/";
const CASH = "Cash-in-Hand", BANK = "Bank Accounts";
// Internal money movement: FROM is credited (money out, −), TO is debited (money in, +).
export const TRANSACTION_TYPES = [["DEPOSIT", "Cash Deposit"], ["WITHDRAWAL", "Cash Withdrawal"], ["TRANSFER", "Bank Transfer"]];
export const typeLabel = type => TRANSACTION_TYPES.find(([value]) => value === type)?.[1] || type || "";
const DIRECTIONS = { DEPOSIT: [CASH, BANK], WITHDRAWAL: [BANK, CASH], TRANSFER: [BANK, BANK] };
export const accountGroups = type => DIRECTIONS[type] || DIRECTIONS.DEPOSIT;
// Payment Mode only describes how money moved (existing modes); it never adds a posting.
const MODE_LABELS = { Cash: "Cash", UPI: "UPI", Cheque: "Cheque", NEFT: "NEFT/IMPS/RGST" };
const MODES = { DEPOSIT: ["Cash"], WITHDRAWAL: ["Cash", "Cheque"], TRANSFER: ["NEFT", "UPI", "Cheque"] };
export const modesFor = type => (MODES[type] || []).map(value => [value, MODE_LABELS[value]]);
export const modeLabel = mode => MODE_LABELS[mode] || mode || "";
// Same notes as Collection / Payment Entry's Cash Denomination popup (plus coins).
export const CASH_DENOMINATIONS = [2000, 500, 200, 100, 50, 20, 10];
const today = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
export const blankTransfer = (transaction_type="DEPOSIT") => ({ transaction_type,date:today(),from_account:"",to_account:"",amount:"",payment_mode:MODES[transaction_type]?.[0]||"",notes:"" });
export function validateTransfer(form,ledgers) {
 if(!form.date) return "Transaction Date is required.";
 if(!DIRECTIONS[form.transaction_type]) return "Select a Transaction.";
 const [source,target]=accountGroups(form.transaction_type);
 if(!form.from_account) return "Select the From account.";
 if(!form.to_account) return "Select the To account.";
 if(ledgers.find(item=>String(item.id)===String(form.from_account))?.group!==source) return "Select a valid From Account.";
 if(ledgers.find(item=>String(item.id)===String(form.to_account))?.group!==target) return "Select a valid To Account.";
 if(String(form.from_account)===String(form.to_account)) return "From and To accounts must differ.";
 if(!Number.isFinite(Number(form.amount))||Number(form.amount)<=0) return "Enter an amount greater than zero.";
 if(!MODES[form.transaction_type].includes(form.payment_mode)) return "Select a valid Payment Mode.";
 return "";
}
export const filterTransfers = (rows,{search="",type="",from="",to=""}) => rows.filter(row =>
 (!type||row.transaction_type===type)&&(!from||row.date>=from)&&(!to||row.date<=to)&&
 [row.voucher_no,row.from_account_name,row.to_account_name,row.reference_no,row.notes,typeLabel(row.transaction_type),modeLabel(row.payment_mode)].join(" ").toLowerCase().includes(search.trim().toLowerCase()));
