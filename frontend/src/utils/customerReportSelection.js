export const loanCustomer = loan => String(loan?.customer?.id ?? loan?.customer_id ?? (typeof loan?.customer !== 'object' ? loan?.customer : '') ?? '');
export const loansForCustomer = (loans, customer) => loans.filter(loan => !customer || loanCustomer(loan) === String(customer));
export const validPair = (loans, pair) => !!pair.customer && !!pair.loanId && loans.some(loan => String(loan.id) === String(pair.loanId) && loanCustomer(loan) === String(pair.customer));
export function selectCustomer(loans, pair, customer) {
 const next = { customer: String(customer || ''), loanId: String(pair.loanId || '') };
 if (!validPair(loans, next)) next.loanId = '';
 return next;
}
export function selectLoan(loans, loanId) {
 const loan = loans.find(loan => String(loan.id) === String(loanId));
 return loan ? { customer: loanCustomer(loan), loanId: String(loan.id) } : { customer: '', loanId: '' };
}
// A report scope is runnable with a customer alone (all of that customer's loans) or with a
// customer + one of that customer's own loans. A loan that belongs to someone else never is.
export const scopeReady = (loans, pair) => !!pair.customer && (!pair.loanId || validPair(loans, pair));
