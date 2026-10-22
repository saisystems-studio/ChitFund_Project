# Add Customer scrolling fix

Application change: frontend/src/pages/customers/CustomerFormGrid.css only. QA harness: frontend/qa/customer-scroll.

Cause: Add Customer overrides set the main area and page to overflow:hidden and constrain the page/form to viewport height. The new scoped rules give main-content vertical scrolling, hide its scrollbar, remove child height/overflow constraints, keep the footer in normal flow, center the three actions on one row and reserve 32px plus safe-area bottom padding. Sidebar and unrelated pages are unchanged. Customer Edit already uses the main area's normal scroll behavior and was not modified.

Chrome verification passed at 1440, 800 and 390px widths: mouse-wheel scrolling, Ctrl+Home/Ctrl+End keyboard scrolling, equal action-button baselines, visible/clickable Save/Reset/Cancel, hidden scrollbar and stationary sidebar. Six queued attachments did not clip the footer. The existing Save handler successfully submitted a valid customer followed by all six attachments to the correct entity endpoint using a mock API. No production records were written. Physical touch/trackpad hardware was not exercised; native overflow scrolling remains enabled and no event interception was added.

Production build passed with the existing bundle-size warning. No pushes or deployments.
