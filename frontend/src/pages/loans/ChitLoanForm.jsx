import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./ChitLoanForm.module.css";
import "./chit-loan-exact.css";
import "./chit-loan-responsive.css";
import "./loan-application-header.css";
import "./loan-schedule-preview.css";
import "./loan-application-clean.css";
import { formatINR } from "../../utils/currency";
import PageBreadcrumb from "../../components/PageBreadcrumb";
import LoanDateInput from "./LoanDateInput";
import StaffDropdown from "../../components/StaffDropdown/StaffDropdown";
import { toApiDate, chitPreviewPayload, calculateChitEndDate } from "../../utils/loanSchedulePayload";
import { downloadInterestSchedulePdf } from "../../utils/interestSchedulePdf";
import { useCompanyProfile } from "../../components/CompanyProfileContext";

const periodicLetters = { Daily: "D", Weekly: "W", Monthly: "M", Quarterly: "Q", "Half-Yearly": "H", Others: "O", "100 Days": "100" };
const normalizePeriodName = value => String(value || "").trim().toLowerCase() === "other" ? "Others" : String(value || "").trim();
const validYearDay = month => Number(month) === 2 ? 29 : [4, 6, 9, 11].includes(Number(month)) ? 30 : 31;
const weekdays = [["M", "Monday"], ["T", "Tuesday"], ["W", "Wednesday"], ["T", "Thursday"], ["F", "Friday"], ["S", "Saturday"], ["S", "Sunday"]];
const rowsOf = data => data?.results ?? data ?? [];
const getLocalToday = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

export default function ChitLoanForm({ api, auth, go, id = null }) {
  const [applicationDate, setApplicationDate] = useState(getLocalToday);
  useEffect(() => { if (!id) api.get("/finance/loans/application-date/", auth).then(({ data }) => setApplicationDate(data.application_date)).catch(() => {}); }, [id]);
  const draftKey = `chitufund:draft:loan-application:${id || "new"}`;
  const [customers, setCustomers] = useState([]), [groups, setGroups] = useState([]), [holidays, setHolidays] = useState([]), [loanTypes, setLoanTypes] = useState([]), [installments, setInstallments] = useState([]), [mortgageProducts, setMortgageProducts] = useState([]);
  const [customer, setCustomer] = useState(""), [selectedLoanTypeId, setSelectedLoanTypeId] = useState(""), [groupId, setGroupId] = useState("");
  const [doneByStaff, setDoneByStaff] = useState("");
  const [savedMortgage, setSavedMortgage] = useState(null);
  const [savedGroupId, setSavedGroupId] = useState("");
  const [mortgageProductId, setMortgageProductId] = useState(""), [mortgageQuantity, setMortgageQuantity] = useState(""), [mortgageInterest, setMortgageInterest] = useState("");
  const [periodic, setPeriodic] = useState(null), [weekDays, setWeekDays] = useState([2]), [interestWeekday, setInterestWeekday] = useState(null), [interestDate, setInterestDate] = useState("1"), [interestMonth, setInterestMonth] = useState("1"), [selectedHolidays, setSelectedHolidays] = useState([]);
  const [form, setForm] = useState({ amount: "", startDate: getLocalToday(), includeSunday: false });
  const [interestPercentage, setInterestPercentage] = useState("");
  const [interestDuration, setInterestDuration] = useState("12");
  const [interestDurationUnit, setInterestDurationUnit] = useState("MONTH");
  const [schedule, setSchedule] = useState([]), [endDate, setEndDate] = useState(""), [showHolidays, setShowHolidays] = useState(false), [error, setError] = useState(""), [saving, setSaving] = useState(false), [loadingEdit, setLoadingEdit] = useState(Boolean(id)), [editPeriodicity, setEditPeriodicity] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(true), [accordionOpen, setAccordionOpen] = useState(null);
  const draftRestored = useRef(false);
  // The unselected loan-type view still uses this preview component. Keep its
  // legacy boolean interface backed by the mutually-exclusive accordion state.
  const schedulePreviewOpen = accordionOpen === "schedule";
  const setSchedulePreviewOpen = value => setAccordionOpen(current => {
    const next = typeof value === "function" ? value(current === "schedule") : value;
    return next ? "schedule" : null;
  });

  useEffect(() => {
    if (id) { draftRestored.current = true; return; }
    try {
      const saved = sessionStorage.getItem(draftKey), draft = saved ? JSON.parse(saved) : null;
      if (draft && typeof draft === "object" && !Array.isArray(draft)) {
        setCustomer(typeof draft.customer === "string" ? draft.customer : "");
        setSelectedLoanTypeId(typeof draft.selectedLoanTypeId === "string" ? draft.selectedLoanTypeId : "");
        setGroupId(typeof draft.groupId === "string" ? draft.groupId : "");
        setPeriodic(draft.periodic ?? null);
        setWeekDays(Array.isArray(draft.weekDays) ? draft.weekDays : [2]);
        setInterestWeekday(draft.interestWeekday ?? null);
        setInterestDate(typeof draft.interestDate === "string" ? draft.interestDate : "1");
        setInterestMonth(typeof draft.interestMonth === "string" ? draft.interestMonth : "1");
        setSelectedHolidays(Array.isArray(draft.selectedHolidays) ? draft.selectedHolidays : []);
        setForm(draft.form && typeof draft.form === "object" && !Array.isArray(draft.form) ? { amount: "", startDate: getLocalToday(), includeSunday: false, ...draft.form, startDate: toApiDate(draft.form.startDate || getLocalToday()) } : { amount: "", startDate: getLocalToday(), includeSunday: false });
        setInterestPercentage(typeof draft.interestPercentage === "string" ? draft.interestPercentage : "");
        setMortgageProductId(typeof draft.mortgageProductId === "string" ? draft.mortgageProductId : "");
        setMortgageQuantity(typeof draft.mortgageQuantity === "string" ? draft.mortgageQuantity : "");
        setMortgageInterest(typeof draft.mortgageInterest === "string" ? draft.mortgageInterest : "");
        setInterestDuration(typeof draft.interestDuration === "string" ? draft.interestDuration : "12");
        setInterestDurationUnit(typeof draft.interestDurationUnit === "string" ? draft.interestDurationUnit : "MONTH");
      }
    } catch {}
    draftRestored.current = true;
  }, [id, draftKey]);
  useEffect(() => {
    if (id || !draftRestored.current) return;
    try { sessionStorage.setItem(draftKey, JSON.stringify({ customer, selectedLoanTypeId, groupId, mortgageProductId, mortgageQuantity, mortgageInterest, periodic, weekDays, interestWeekday, interestDate, interestMonth, selectedHolidays, form, interestPercentage, interestDuration, interestDurationUnit })); } catch {}
  }, [id, draftKey, customer, selectedLoanTypeId, groupId, mortgageProductId, mortgageQuantity, mortgageInterest, periodic, weekDays, interestWeekday, interestDate, interestMonth, selectedHolidays, form, interestPercentage, interestDuration, interestDurationUnit]);
  const resetForm = () => {
    clearLoanDraft(); try { sessionStorage.removeItem("chitufund:draft:loan-application:new"); } catch {} setSavedMortgage(null); setCustomer(""); setSelectedLoanTypeId(""); setGroupId("");
    setMortgageProductId(""); setMortgageQuantity(""); setMortgageInterest("");
    setPeriodic(null); setWeekDays([2]); setInterestWeekday(null); setInterestDate("1"); setInterestMonth("1");
    setSelectedHolidays([]); setForm({ amount: "", startDate: getLocalToday(), includeSunday: false });
    setInterestPercentage(""); setInterestDuration("12"); setInterestDurationUnit("MONTH");
    setSchedule([]); setEndDate(""); setShowHolidays(false); setError(""); setEditPeriodicity(""); setAccordionOpen(null); setDetailsOpen(true);
    if (id) go("/loan-application");
  };
  const clearLoanDraft = () => { try { sessionStorage.removeItem(draftKey); } catch {} };

  useEffect(() => {
    if (!detailsOpen) return undefined;
    const expandedSection = document.querySelector(".exact-left .loan-details-expanded");
    if (!expandedSection) return undefined;
    const frame = requestAnimationFrame(() => expandedSection.scrollIntoView({ behavior: "smooth", block: "nearest" }));
    return () => cancelAnimationFrame(frame);
  }, [detailsOpen]);

  useEffect(() => {
    api.get("/customers/", { ...auth, params: { page_size: 1000 } }).then(({ data }) => setCustomers(rowsOf(data))).catch(() => {});
    api.get("/finance/chit-groups/", auth).then(({ data }) => setGroups(rowsOf(data))).catch(() => setError("Unable to load Chit Groups."));
    api.get("/finance/mortgages/", auth).then(({ data }) => setMortgageProducts(rowsOf(data))).catch(() => {});
    api.get("/finance/holidays/", auth).then(({ data }) => setHolidays(rowsOf(data))).catch(() => {});
    api.get("/finance/loan-installments/", auth).then(({ data }) => setInstallments(rowsOf(data).filter(item => String(item.name || "").trim().toLowerCase() !== "annual").map(item => ({ ...item, name: normalizePeriodName(item.name) })))).catch(() => {});
    api.get("/finance/loan-types/", auth).then(({ data }) => { const priority = { chit: 0, interest: 1, mortgage: 2 }; const rows = rowsOf(data).filter(item => item.is_active !== false).map(item => { const rawName = (item.name || item.loan_type_name || "").trim(); const key = rawName.toLowerCase(); return key === "chit" ? { ...item, name: "Chit" } : key === "interest" ? { ...item, name: "Interest" } : key === "mortgage" ? { ...item, name: "Mortgage" } : { ...item, name: rawName }; }).sort((a, b) => (priority[a.name.toLowerCase()] ?? 3) - (priority[b.name.toLowerCase()] ?? 3) || Number(a.id) - Number(b.id)); setLoanTypes(rows); }).catch(() => setLoanTypes([]));
  }, []);
  useEffect(() => {
    if (!id) return;
    Promise.all([api.get(`/finance/loans/${id}/`, auth), api.get("/finance/loan-holiday-settings/", { ...auth, params: { page_size: 1000 } })]).then(([loanResponse, holidayResponse]) => {
      const loan = loanResponse.data;
      setApplicationDate(loan.application_date || "");
      setCustomer(String(loan.customer?.id ?? loan.customer_id ?? ""));
      setDoneByStaff(String(loan.done_by_staff ?? ""));
      setSelectedLoanTypeId(String(loan.loan_type?.id ?? loan.loan_type_id ?? ""));
      setGroupId(String(loan.plan?.id ?? loan.chit_group_id ?? ""));
      setSavedGroupId(String(loan.plan?.id ?? loan.chit_group_id ?? ""));
      setEditPeriodicity(loan.periodicity?.name || loan.periodicity_name || "");
      setForm({ amount: String(loan.loan_amount ?? loan.total_amount ?? ""), startDate: toApiDate(loan.start_date || loan.loan_start_date || getLocalToday()), includeSunday: Boolean(loan.include_sunday) });
      if (loan.interest_details) { setInterestWeekday(loan.interest_details.collection_day ?? null); setInterestPercentage(String(loan.interest_details.interest_percentage ?? "")); setInterestDuration(String(loan.interest_details.duration_value ?? "12")); setInterestDurationUnit(loan.interest_details.duration_type || (["daily", "100 days"].includes(String(loan.interest_details.periodicity || "Monthly").toLowerCase()) ? "DAY" : String(loan.interest_details.periodicity || "Monthly").toLowerCase() === "weekly" ? "WEEK" : String(loan.interest_details.periodicity || "Monthly").toLowerCase() === "annual" ? "YEAR" : "MONTH")); setInterestDate(String(loan.interest_details.collection_date ? new Date(loan.interest_details.collection_date).getDate() : "1")); setInterestMonth(String(loan.interest_details.collection_month || "1")); }
      if (loan.mortgage_details) { setSavedMortgage(loan.mortgage_details); setMortgageProductId(String(loan.mortgage_details.product ?? "")); setMortgageQuantity(String(loan.mortgage_details.quantity ?? "")); setMortgageInterest(String(loan.mortgage_details.interest_percentage ?? "")); }
      setSelectedHolidays(rowsOf(holidayResponse.data).filter(item => String(item.loan ?? item.loan_id) === String(id) && item.include_in_schedule).map(item => item.holiday ?? item.holiday_id));
    }).catch(() => setError("Unable to load the existing loan details.")).finally(() => setLoadingEdit(false));
  }, [id]);
  const selectedType = loanTypes.find(item => String(item.id) === String(selectedLoanTypeId));
  const normalizedType = (selectedType?.name || selectedType?.loan_type_name || "").trim().toLowerCase();
  const isChit = normalizedType === "chit";
  const isInterest = normalizedType === "interest";
  const isMortgage = normalizedType === "mortgage";
  const selectedLoanTypeName = selectedType?.name || selectedType?.loan_type_name || "";
  const loanType = selectedLoanTypeName;
  const activeType = selectedType;
  const allowedIds = Array.isArray(activeType?.allowed_installment_ids) ? activeType.allowed_installment_ids.map(Number) : [];
  const allowed = useMemo(() => selectedType ? installments.filter(item => allowedIds.includes(Number(item.id))) : [], [selectedType, installments, allowedIds.join(",")]);
  const selectedPeriodName = normalizePeriodName(allowed.find(item => Number(item.id) === Number(periodic))?.name || "");
  const periodicName = selectedPeriodName === "Others" ? "Annual" : selectedPeriodName;
  const periodicityValue = selectedPeriodName === "Others" ? "Other" : periodicName;
  const choosePeriodic = id => { setPeriodic(id); if (isInterest) { setInterestWeekday(null); const item = installments.find(row => Number(row.id) === Number(id)); const yearly = normalizePeriodName(item?.name) === "Others"; setInterestDurationUnit(yearly ? "YEAR" : normalizePeriodName(item?.name) === "100 Days" ? "DAY" : "MONTH"); if (normalizePeriodName(item?.name) === "100 Days") setInterestDuration("100"); setInterestDate(yearly ? String(selectedType?.due_day || "1") : "1"); setInterestMonth(yearly ? String(selectedType?.due_month || "1") : "1"); } };
  const group = groups.find(item => String(item.id) === String(groupId));
  const selectableGroups = groups.filter(item => item.is_active !== false || (id && String(item.id) === savedGroupId));
  const currentMortgageProduct = mortgageProducts.find(item => String(item.id) === String(mortgageProductId));
  const mortgageProduct = savedMortgage && String(savedMortgage.product) === String(mortgageProductId) ? { ...currentMortgageProduct, current_rate: savedMortgage.current_rate, unit: savedMortgage.unit, product_name: savedMortgage.product_name } : currentMortgageProduct;
  const templateRows = [...(group?.installments || group?.template_installments || [])].sort((a, b) => Number(a.installment_number ?? a.installment_no ?? 0) - Number(b.installment_number ?? b.installment_no ?? 0));
  const visibleHolidays = useMemo(() => holidays.filter(item => item.holiday_date?.startsWith(form.startDate.slice(0, 7))), [holidays, form.startDate]);
  const chosen = visibleHolidays.filter(item => selectedHolidays.includes(item.id));
  const update = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const date = value => value ? new Date(`${value}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "";
  const durationLabel = group ? `${group.duration} ${group.duration_type === "DAY" ? "Days" : group.duration_type === "MONTH" ? "Months" : "Years"}` : "";
  const totalInstallments = templateRows.length;
  const chitInstallmentAmount = templateRows[0]?.installment_amount || "";
  const interestPrincipal = Number(form.amount || 0);
  const interestValue = interestPrincipal * Number(interestPercentage || 0) / 100;
  const interestTotal = interestPrincipal + interestValue;
  const interestCount = Math.max(0, Number(interestDuration || 0));
  const interestInstallment = interestCount ? interestTotal / interestCount : 0;
  const interestDurationLabel = interestDuration ? `${interestDuration} ${interestDurationUnit === "DAY" ? "Days" : interestDurationUnit === "WEEK" ? "Weeks" : interestDurationUnit === "YEAR" ? "Years" : "Months"}` : "";
  const interestRows = isInterest && interestCount && form.startDate && periodicName ? buildInterestSchedule({ startDate: form.startDate, periodicity: periodicName, duration: interestCount, durationUnit: interestDurationUnit, weekday: interestWeekday, collectionDate: interestDate, collectionMonth: interestMonth, amount: interestTotal, installmentAmount: interestInstallment, includeSunday: form.includeSunday, blockedHolidays: holidays.filter(item => !selectedHolidays.includes(item.id)).map(item => item.holiday_date) }) : [];
  const interestEndDate = interestRows.at(-1)?.due_date || "";
  const mortgageMarketValue = Number(mortgageQuantity || 0) * Number(mortgageProduct?.current_rate || 0);
  const mortgageDailyInterest = Number(form.amount || 0) * Number(mortgageInterest || 0) / 100 / 365;
  const money = formatINR;
  const saveLoan = async event => {
    event.preventDefault();
    if (saving) return;
    if (!customer) return setError("Select a customer before saving the loan.");
    if (isMortgage) {
      if (!selectedLoanTypeId) return setError("Select the Mortgage loan type before saving.");
      if (mortgageQuantity !== "" && Number(mortgageQuantity) <= 0) return setError("Enter a valid Quantity.");
      if (Number(form.amount) <= 0) return setError("Enter a valid Loan Amount.");
      if (Number(mortgageInterest) <= 0) return setError("Enter a valid Rate of Interest.");
      if (!doneByStaff) return setError("Done By is required.");
      setSaving(true); setError("");
      try {
        const payload = { customer_id: customer, loan_type_id: selectedLoanTypeId, mortgage_product_id: mortgageProductId, quantity: mortgageQuantity, amount: form.amount, interest_percentage: mortgageInterest, start_date: toApiDate(form.startDate || getLocalToday()), done_by_staff: doneByStaff };
        if (id) await api.put(`/finance/loans/${id}/`, payload, auth); else await api.post("/finance/loans/", payload, auth);
        clearLoanDraft(); go("/loan-list");
      } catch (requestError) { const detail = requestError.response?.data?.detail; setError(typeof detail === "string" ? detail : "Unable to save the Mortgage loan."); } finally { setSaving(false); }
      return;
    }
    if (isInterest) {
      if (!selectedLoanTypeId) return setError("Select the Interest loan type before saving.");
      if (interestPrincipal <= 0) return setError("Enter a valid principal amount before saving.");
      if (Number(interestPercentage) <= 0) return setError("Enter a valid Interest Percentage.");
      if (!periodic) return setError("Select a collection periodicity before saving.");
      if (!interestCount) return setError("Enter a valid duration.");
      if (!form.startDate) return setError("Select a loan start date before saving.");
      if (periodicName === "Weekly" && interestWeekday === null) return setError("Select a Collection Day for weekly payments.");
      if (periodicName === "Monthly" && !interestDate) return setError("Select a Collection Date for monthly payments.");
      if (periodicName === "Annual" && (!interestMonth || !interestDate)) return setError("Select Collection Month and Date for annual payments.");
      if (!doneByStaff) return setError("Done By is required.");
      setSaving(true); setError("");
      try {
        const payload = { customer_id: customer, loan_type_id: selectedLoanTypeId, amount: interestPrincipal, start_date: toApiDate(form.startDate), periodicity: periodicityValue, interest_percentage: interestPercentage, interest_duration: interestCount, interest_duration_type: interestDurationUnit, interest_collection_day: periodicName === "Weekly" ? interestWeekday : periodicName === "Monthly" || periodicName === "Annual" ? interestDate : null, interest_collection_month: periodicName === "Annual" ? interestMonth : null, include_sunday: form.includeSunday, done_by_staff: doneByStaff };
        if (id) await api.put(`/finance/loans/${id}/`, payload, auth); else await api.post("/finance/loans/", payload, auth);
        clearLoanDraft(); go("/loan-list");
      } catch (requestError) { const detail = requestError.response?.data?.detail; setError(typeof detail === "string" ? detail : "Unable to save the Interest loan."); } finally { setSaving(false); }
      return;
    }
    if (!isChit || !selectedLoanTypeId) return setError("Select the Chit loan type before saving.");
    if (!groupId) return setError("Select a Chit Group before saving.");
    if (!selectableGroups.some(item => String(item.id) === String(groupId))) return setError("Select an active Chit Group before saving.");
    if (!templateRows.length) return setError("Save the Chit Group installment template before saving the loan.");
    if (!form.amount || Number(form.amount) <= 0) return setError("The selected Chit Group has no Chit Amount.");
    if (!form.startDate) return setError("Select a loan start date before saving.");
    if (!doneByStaff) return setError("Done By is required.");
    setSaving(true);
    setError("");
    try {
      const payload = {
        customer_id: customer,
        loan_type_id: selectedLoanTypeId,
        chit_group_id: groupId,
        amount: form.amount,
        start_date: toApiDate(form.startDate),
        include_sunday: form.includeSunday,
        selected_holidays: selectedHolidays,
        done_by_staff: doneByStaff,
      };
      if (id) await api.put(`/finance/loans/${id}/`, payload, auth);
      else await api.post("/finance/loans/", payload, auth);
      clearLoanDraft(); go("/loan-list");
    } catch (requestError) {
      const detail = requestError.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "Unable to save the loan. Please check the entered details and try again.");
    } finally {
      setSaving(false);
    }
  };
  const preview = async () => {
    if (!customer || !group || !isChit || !templateRows.length || (!form.startDate && !group.start_date)) { setSchedule([]); setEndDate(""); setError(""); return; }
    try {
      const { data } = await api.post("/finance/chit-loans/preview-schedule/", chitPreviewPayload(group, form.startDate, form.includeSunday || selectedHolidays.some(id => String(id).startsWith("sunday-")), visibleHolidays.filter(item => !selectedHolidays.includes(item.id)).map(item => item.holiday_date)), auth);
      setSchedule(data.installments || []); setEndDate(data.loan_end_date || ""); setError("");
    } catch (requestError) { setSchedule([]); setEndDate(""); setError(requestError.response?.data?.detail || requestError.message || "Unable to calculate schedule."); }
  };
  useEffect(() => { preview(); }, [customer, groupId, form.startDate, form.includeSunday, selectedHolidays.join(","), group, isChit, holidays]);

  useEffect(() => { setDetailsOpen(true); setAccordionOpen(null); }, [selectedLoanTypeId]);
  useEffect(() => { if (editPeriodicity) { const match = allowed.find(item => normalizePeriodName(item.name).toLowerCase() === normalizePeriodName(editPeriodicity).toLowerCase()); if (match) { setPeriodic(match.id); setEditPeriodicity(""); return; } } if (!allowed.some(item => Number(item.id) === Number(periodic))) setPeriodic(null); }, [selectedLoanTypeId, installments, loanTypes, editPeriodicity, allowed, periodic]);
  useEffect(() => { if (!id && isInterest && selectedPeriodName === "Others" && selectedType) { setInterestDurationUnit("YEAR"); setInterestMonth(String(selectedType.due_month || interestMonth || "1")); setInterestDate(String(selectedType.due_day || interestDate || "1")); } }, [selectedLoanTypeId, periodic, selectedType?.due_month, selectedType?.due_day]);
  useEffect(() => { if (periodicName === "Annual" && interestMonth) setInterestDate(value => String(Math.min(Number(value) || 1, validYearDay(interestMonth)))); }, [interestMonth, periodicName]);

  const chitPreviewRows = templateRows.map((row, index) => ({ installment_number: row.installment_number ?? index + 1, schedule_value: row.schedule_value, due_date: schedule[index]?.due_date || "", amount: Number(row.installment_amount || 0) }));
  const title = id ? "Edit Loan Application" : isChit ? "Chit Loan Application" : isInterest ? "Interest Loan Application" : isMortgage ? "Mortgage Loan Application" : "Loan Application";
  if (loadingEdit) return <div className="exact-loan-page"><div className="exact-empty">Loading existing loan details...</div></div>;
  if (isChit) return <ChitLoanLayout {...{ api, auth, applicationDate, go, resetForm, clearLoanDraft, customer, setCustomer, customers, selectedLoanTypeId, setSelectedLoanTypeId, loanTypes, groupId, setGroupId, groups, allowed, installments, periodic, choosePeriodic, form, update, totalInstallments, durationLabel, endDate, chitInstallmentAmount, chosen, setShowHolidays, showHolidays, visibleHolidays, selectedHolidays, setSelectedHolidays, accordionOpen, setAccordionOpen, chitPreviewRows, saving, saveLoan, error, id, group, templateRows, selectableGroups, doneByStaff, setDoneByStaff }} />;
  if (isInterest) return <InterestLoanLayout {...{ api, auth, applicationDate, go, resetForm, clearLoanDraft, customer, setCustomer, customers, selectedLoanTypeId, setSelectedLoanTypeId, loanTypes, form, update, interestPercentage, setInterestPercentage, periodic, periodicName, allowed, installments, choosePeriodic, interestDuration, setInterestDuration, interestDurationUnit, setInterestDurationUnit, interestWeekday, setInterestWeekday, interestDate, setInterestDate, interestMonth, setInterestMonth, accordionOpen, setAccordionOpen, interestRows, interestEndDate, interestTotal, interestValue, interestInstallment, interestCount, money, saveLoan, error, saving, id, chosen, visibleHolidays, selectedHolidays, setSelectedHolidays, showHolidays, setShowHolidays, doneByStaff, setDoneByStaff }} />;
  if (isMortgage) return <MortgageLoanLayout {...{ api, auth, applicationDate, go, resetForm, clearLoanDraft, customer, setCustomer, customers, selectedLoanTypeId, setSelectedLoanTypeId, loanTypes, mortgageProducts, mortgageProductId, setMortgageProductId, mortgageProduct, mortgageQuantity, setMortgageQuantity, form, update, mortgageMarketValue, mortgageInterest, setMortgageInterest, mortgageDailyInterest, money, saveLoan, error, saving, id, doneByStaff, setDoneByStaff }} />;
  return <div className={`exact-loan-page ${selectedType ? "has-loan-type" : "no-loan-type"} ${isInterest ? "is-interest" : "is-chit"}`}>
    <header className="exact-header"><PageBreadcrumb root="Transactions" current="Loan Application" onBack={() => go("/loan-list")} /><ApplicationDate value={applicationDate}/><strong>LOAN TYPE: {loanType.toUpperCase()}</strong></header>
    {error && <div className="exact-error">{error}</div>}
    <form className="exact-workspace" onSubmit={saveLoan}>
      <section className="exact-panel exact-left"><PanelTitle icon="â™Ÿ" title="Loan Details"/><div className="exact-two"><Field label="Customer" required><select value={customer} onChange={event => setCustomer(event.target.value)}><option value="">Select Customer</option>{customers.map(item => <option key={item.id} value={item.id}>{item.full_name || item.name}</option>)}</select></Field><Field label="Loan Type" required><div className="exact-select-plus"><select value={selectedLoanTypeId} onChange={event => { setSelectedLoanTypeId(String(event.target.value)); setGroupId(""); }}><option value="">Select Loan Type</option>{loanTypes.map(item => <option key={item.id} value={String(item.id)}>{item.name || item.loan_type_name}</option>)}</select><button type="button" onClick={() => go("/loan-types")} aria-label="Add Loan Type">+</button></div></Field></div>
        <Field label="Chit Group" required><select value={groupId} disabled={!isChit} onChange={event => setGroupId(event.target.value)}><option value="">{isChit ? "Search Chit Group..." : "Select Loan Type First..."}</option>{groups.map(item => <option key={item.id} value={item.id}>{item.name || item.chit_group_name} - {item.duration} {item.duration_type === "DAY" ? "Days" : "Months"}</option>)}</select></Field>{isInterest && <div className="exact-plan-note"><b>Flat Interest</b><span>Interest plan selected</span></div>}{isInterest && periodicName === "Weekly" && <div className="interest-schedule-field"><b>Collection Day <i>*</i></b><div className="interest-weekdays">{weekdays.map(([letter, name], index) => <button type="button" title={name} className={interestWeekday === index ? "selected" : ""} onClick={() => setInterestWeekday(index)} key={name}>{letter}</button>)}</div></div>}{isInterest && periodicName === "Monthly" && <Field label="Collection Date" required><select value={interestDate} onChange={event => setInterestDate(event.target.value)}>{Array.from({ length: 31 }, (_, index) => <option value={index + 1} key={index + 1}>{index + 1}</option>)}</select></Field>}{isInterest && periodicName === "Annual" && <div className="interest-annual-fields"><Field label="Collection Month" required><select value={interestMonth} onChange={event => setInterestMonth(event.target.value)}>{Array.from({ length: 12 }, (_, index) => <option value={index + 1} key={index + 1}>{new Date(2000, index, 1).toLocaleString("en-IN", { month: "long" })}</option>)}</select></Field><Field label="Collection Date" required><select value={interestDate} onChange={event => setInterestDate(event.target.value)}>{Array.from({ length: 31 }, (_, index) => <option value={index + 1} key={index + 1}>{index + 1}</option>)}</select></Field></div>}
        <div className="exact-field-label">Collection Plan <i>*</i></div><div className="exact-periodics">{allowed.map(item => <button type="button" key={item.id} title={item.name} className={Number(periodic) === Number(item.id) ? "selected" : ""} onClick={() => choosePeriodic(item.id)}><b>{periodicLetters[item.name] || item.name.slice(0, 1)}</b><small>{item.name}</small></button>)}</div>{periodic && !isInterest && allowed.find(item => Number(item.id) === Number(periodic))?.name === "Weekly" && <div className="exact-weekdays"><span>Collection Day</span><div>{weekdays.map(([letter, name], index) => <button type="button" title={name} className={weekDays.includes(index) ? "selected" : ""} onClick={() => setWeekDays(current => current.includes(index) ? current.filter(day => day !== index) : [...current, index])} key={name}>{letter}</button>)}</div></div>}
        <div className="toggle-row"><button type="button" className="loan-details-toggle schedule-section-header" onClick={() => setDetailsOpen(value => !value)} aria-expanded={detailsOpen}><span>Loan Schedule Details</span><span aria-hidden="true">{detailsOpen ? "▲" : "▼"}</span></button></div>{detailsOpen && <div className="loan-details-expanded"><div className="exact-fields three"><Field label="Loan Amount" required><input type="number" placeholder="₹0.00" value={form.amount} onChange={event => update("amount", event.target.value)}/></Field><Field label="Loan Start Date" required><LoanDateInput value={form.startDate} onChange={value => update("startDate", value)}/></Field><Field label="Total Installments"><input className="readonly" value={totalInstallments || ""} readOnly/></Field><Field label="Duration"><input className="readonly" value={durationLabel} readOnly/></Field><Field label="Loan End Date"><input className="readonly" value={endDate ? date(endDate) : ""} readOnly/></Field><Field label="Installment Amount"><input className="readonly" value={chitInstallmentAmount || ""} readOnly/></Field></div></div>}{group && !templateRows.length && <div className="template-warning">This Chit Group does not have an installment template. Edit the Chit Group and save its installment schedule first.</div>}
        <div className="exact-holiday-title">â–£ &nbsp; Holiday Rules</div><div className="exact-holiday-row"><div><b>Sunday Collection</b><label className="exact-toggle"><input type="checkbox" checked={form.includeSunday} onChange={event => update("includeSunday", event.target.checked)}/><span/></label><small>{form.includeSunday ? "Include Sunday in schedule" : "Exclude Sunday in schedule"}</small></div><div><b>Holiday Handling</b><select><option>Skip Holiday & Move to Next Working Day</option></select></div><div><b>Manage Holidays</b><strong className="exact-green">Selected Holidays: {chosen.length}</strong><button type="button" className="exact-manage" onClick={() => setShowHolidays(true)}>Manage Holidays</button><div className="exact-chips">{chosen.map(item => <span key={item.id}>{date(item.holiday_date)} Ã—</span>)}</div></div></div>
      </section>
      <SchedulePreview rows={chitPreviewRows} isChit money={formatINR} open={schedulePreviewOpen} onToggle={() => setSchedulePreviewOpen(value => !value)} emptyMessage={group && !templateRows.length ? "Save the Chit Group installment template first." : "Select a Chit Group and Start Date"} totalAmount={Number(group?.grand_total ?? group?.total_amount ?? 0)} />
      <footer className="exact-actions"><button type="button" onClick={() => go("/loan-list")}>Ã— &nbsp; Cancel</button><button type="button" onClick={resetForm}>â†¶ &nbsp; Reset</button><button type="submit" className="save" disabled={saving}>{saving ? "Savingâ€¦" : "Save"}</button></footer>
    </form>
    {showHolidays && <div className="exact-overlay" onMouseDown={event => event.target === event.currentTarget && setShowHolidays(false)}><div className="exact-holiday-modal"><div><h2>Manage Holidays</h2><button type="button" onClick={() => setShowHolidays(false)}>Ã—</button></div>{visibleHolidays.map(item => <label key={item.id} className={selectedHolidays.includes(item.id) ? "included" : ""}><input type="checkbox" checked={selectedHolidays.includes(item.id)} onChange={() => setSelectedHolidays(current => current.includes(item.id) ? current.filter(id => id !== item.id) : [...current, item.id])}/>{date(item.holiday_date)} <b>{item.holiday_name}</b></label>)}<button className="save" type="button" onClick={() => setShowHolidays(false)}>Apply</button></div></div>}
  </div>;
}
function PlanOptions({ allowed, periodic, choosePeriodic }) {
  return <div className="collection-plan-options">{allowed.map(item => { const label = periodicLetters[item.name] || item.name.slice(0, 1); return <button type="button" key={item.id} title={item.name} className={`collection-plan-option ${label === "100" ? "option-100" : ""} ${Number(periodic) === Number(item.id) ? "selected" : ""}`} onClick={() => choosePeriodic(item.id)}>{label}</button>; })}</div>;
}

function ChitLoanLayout({ api, auth, applicationDate, go, resetForm, clearLoanDraft, customer, setCustomer, customers, selectedLoanTypeId, setSelectedLoanTypeId, loanTypes, groupId, setGroupId, groups, allowed, installments, periodic, choosePeriodic, form, update, totalInstallments, durationLabel, endDate, chitInstallmentAmount, chosen, setShowHolidays, showHolidays, visibleHolidays, selectedHolidays, setSelectedHolidays, accordionOpen, setAccordionOpen, chitPreviewRows, saving, saveLoan, error, id, group, templateRows, selectableGroups, doneByStaff, setDoneByStaff }) {
  return <div className="exact-loan-page clean-loan-page is-chit">
    <header className="exact-header"><PageBreadcrumb root="Transactions" current="Loan Application" onBack={() => go("/loan-list")} /><ApplicationDate value={applicationDate}/></header>
    {error && <div className="exact-error">{error}</div>}
    <form onSubmit={saveLoan}>
      <section className="clean-panel"><h2>Loan Details</h2>
        <div className="clean-top-grid chit-three-grid"><Field label="Customer Name" required><select value={customer} onChange={event => setCustomer(event.target.value)}><option value="">Select Customer</option>{customers.map(item => <option key={item.id} value={item.id}>{item.full_name || item.name}</option>)}</select></Field><Field label="Loan Type" required><select value={selectedLoanTypeId} onChange={event => { setSelectedLoanTypeId(String(event.target.value)); setGroupId(""); }}><option value="">Select Loan Type</option>{loanTypes.map(item => <option key={item.id} value={String(item.id)}>{item.name || item.loan_type_name}</option>)}</select></Field><Field label="Chit Group" required><select value={groupId} onChange={event => { const next = selectableGroups.find(item => String(item.id) === event.target.value); setGroupId(event.target.value); update("amount", String(next?.grand_total ?? next?.total_amount ?? "")); update("startDate", toApiDate(next?.start_date)); }}><option value="">Search Chit Group...</option>{selectableGroups.map(item => <option key={item.id} value={item.id}>{item.name || item.chit_group_name} - {item.duration} {item.duration_type === "DAY" ? "Days" : "Months"}</option>)}</select></Field><Field label="Done By" required><StaffDropdown api={api} auth={auth} value={doneByStaff} onChange={setDoneByStaff} placeholder="Select staff" allowClear/></Field></div>
        <div className="clean-top-grid chit-three-grid"><Field label="Chit Start Date" required><LoanDateInput value={form.startDate} onChange={value => update("startDate", value)}/></Field><Field label="Chit End Date"><LoanDateInput value={calculateChitEndDate(form.startDate, group?.duration, group?.duration_type)} readOnly/></Field><Field label="Chit Amount"><input value={form.amount ? formatINR(form.amount) : ""} readOnly/></Field></div>
        {group && !templateRows.length && <div className="template-warning">This Chit Group does not have an installment template. Edit the Chit Group and save its installment schedule first.</div>}
        <div className="loan-accordion-row"><AccordionControl label="Holiday" open={accordionOpen === "holiday"} onToggle={() => setAccordionOpen(value => value === "holiday" ? null : "holiday")}/><AccordionControl label="Schedule Preview" open={accordionOpen === "schedule"} onToggle={() => setAccordionOpen(value => value === "schedule" ? null : "schedule")}/></div>
        {accordionOpen === "holiday" && <HolidayRules form={form} update={update} chosen={chosen} setShowHolidays={setShowHolidays} contentOnly/>}
        {accordionOpen === "schedule" && <SchedulePreview rows={chitPreviewRows} isChit money={formatINR} contentOnly emptyMessage={group && !templateRows.length ? "Save the Chit Group installment template first." : "Select a Chit Group and Start Date"} totalAmount={Number(group?.grand_total ?? group?.total_amount ?? 0)} />}
      </section>
      <footer className="clean-actions"><button type="button" onClick={() => { clearLoanDraft(); go("/loan-list"); }}>Cancel</button><button type="button" onClick={resetForm}>Reset</button><button type="submit" className="save" disabled={saving}>{saving ? "Saving..." : "Save"}</button></footer>
    </form>
    {showHolidays && <HolidayModal visibleHolidays={visibleHolidays} selectedHolidays={selectedHolidays} setSelectedHolidays={setSelectedHolidays} setShowHolidays={setShowHolidays}/>}
  </div>;
}

function PanelTitle({ icon, title }) { return <div className="exact-panel-title"><i>{icon}</i><h2>{title}</h2></div>; }
function Field({ label, required, children }) { return <label className="exact-field"><span>{label}{required && <i> *</i>}</span>{children}</label>; }

function InterestLoanLayout({ api, auth, applicationDate, go, resetForm, clearLoanDraft, customer, setCustomer, customers, selectedLoanTypeId, setSelectedLoanTypeId, loanTypes, form, update, interestPercentage, setInterestPercentage, periodic, periodicName, allowed, installments, choosePeriodic, interestDuration, setInterestDuration, interestDurationUnit, setInterestDurationUnit, interestWeekday, setInterestWeekday, interestDate, setInterestDate, interestMonth, setInterestMonth, accordionOpen, setAccordionOpen, interestRows, interestEndDate, interestTotal, interestValue, interestInstallment, interestCount, money, saveLoan, error, saving, id, chosen, visibleHolidays, selectedHolidays, setSelectedHolidays, showHolidays, setShowHolidays, doneByStaff, setDoneByStaff }) {
  const { profile: companyProfile } = useCompanyProfile() || {};
  const [pdfBusy, setPdfBusy] = useState(false);
  const durationLabel = interestDuration ? `${interestDuration} ${interestDurationUnit === "DAY" ? "Days" : interestDurationUnit === "WEEK" ? "Weeks" : interestDurationUnit === "YEAR" ? "Years" : "Months"}` : "-";
  const downloadSchedule = async () => {
    if (pdfBusy) return;
    setPdfBusy(true);
    try {
      const customerName = customers.find(item => String(item.id) === String(customer))?.full_name || "-";
      const planType = loanTypes.find(item => String(item.id) === String(selectedLoanTypeId))?.name || "Interest";
      await downloadInterestSchedulePdf({ customerName, planType, principal: Number(form.amount || 0), interestPercentage, startDate: form.startDate, endDate: interestEndDate, durationLabel, rows: interestRows }, companyProfile);
    } finally { setPdfBusy(false); }
  };
  return <div className="exact-loan-page clean-loan-page is-interest">
    <header className="exact-header"><PageBreadcrumb root="Transactions" current="Loan Application" onBack={() => go("/loan-list")} /><ApplicationDate value={applicationDate}/></header>
    {error && <div className="exact-error">{error}</div>}
    <form onSubmit={saveLoan}>
      <section className="clean-panel"><h2>Loan Details</h2>
        <div className="clean-top-grid"><Field label="Customer" required><select value={customer} onChange={event => setCustomer(event.target.value)}><option value="">Select Customer</option>{customers.map(item => <option key={item.id} value={item.id}>{item.full_name || item.name}</option>)}</select></Field><Field label="Loan Type" required><select value={selectedLoanTypeId} onChange={event => setSelectedLoanTypeId(String(event.target.value))}><option value="">Select Loan Type</option>{loanTypes.map(item => <option key={item.id} value={String(item.id)}>{item.name || item.loan_type_name}</option>)}</select></Field><Field label="Done By" required><StaffDropdown api={api} auth={auth} value={doneByStaff} onChange={setDoneByStaff} placeholder="Select staff" allowClear/></Field></div>
        <div className="interest-top-row"><Field label="Loan Amount" required><input type="number" min="0" step="0.01" value={form.amount} onChange={event => update("amount", event.target.value)}/></Field><Field label="Interest Percent" required><div className="percent-input"><input type="number" min="0" step="0.01" value={interestPercentage} onChange={event => setInterestPercentage(event.target.value)}/><b>%</b></div></Field><div className="collection-plan-field"><span className="collection-plan-label">Collection Plan <i>*</i></span><PlanOptions {...{ allowed, allInstallments: installments, periodic, choosePeriodic }}/></div><div className="clean-conditional-fields interest-collection-date">{periodicName === "Weekly" ? <div className="interest-schedule-field"><b>Collection Date <i>*</i></b><div className="interest-weekdays">{weekdays.map(([letter, name], index) => <button type="button" title={name} className={interestWeekday === index ? "selected" : ""} onClick={() => setInterestWeekday(index)} key={`${name}-${index}`}>{letter}</button>)}</div></div> : periodicName === "Monthly" ? <Field label="Collection Date" required><select value={interestDate} onChange={event => setInterestDate(event.target.value)}>{Array.from({ length: 31 }, (_, index) => <option value={index + 1} key={index + 1}>{index + 1}</option>)}</select></Field> : periodicName === "Annual" ? <><Field label="Collection Month" required><select value={interestMonth} onChange={event => setInterestMonth(event.target.value)}>{Array.from({ length: 12 }, (_, index) => <option value={index + 1} key={index + 1}>{new Date(2000, index, 1).toLocaleString("en-IN", { month: "long" })}</option>)}</select></Field><Field label="Collection Date" required><select value={interestDate} onChange={event => setInterestDate(event.target.value)}>{Array.from({ length: 31 }, (_, index) => <option value={index + 1} key={index + 1}>{index + 1}</option>)}</select></Field></> : <Field label="Collection Date"><input value={periodicName || ""} readOnly/></Field>}</div></div>
        <div className="loan-schedule-section"><h3>Loan Schedule Details</h3><div className="interest-schedule-grid interest-six-grid"><Field label="Interest Type"><select value={interestDurationUnit} onChange={event => setInterestDurationUnit(event.target.value)}><option value="DAY">Daily</option><option value="WEEK">Weeks</option><option value="MONTH">Months</option><option value="YEAR">Years</option></select></Field><Field label="Duration" required><input type="number" min="1" value={interestDuration} onChange={event => setInterestDuration(event.target.value)}/></Field><Field label="Start Date" required><LoanDateInput value={form.startDate} onChange={value => update("startDate", value)}/></Field><Calculated label="End Date" value={interestEndDate ? formatDate(interestEndDate) : "-"}/><Calculated label="Installment Amount" value={money(interestInstallment)}/><Calculated label="Payable" value={money(interestTotal)}/></div></div>
        <div className="loan-accordion-row"><AccordionControl label="Holiday" open={accordionOpen === "holiday"} onToggle={() => setAccordionOpen(value => value === "holiday" ? null : "holiday")}/><span className="schedule-preview-heading-group"><AccordionControl label="Schedule Preview" open={accordionOpen === "schedule"} onToggle={() => setAccordionOpen(value => value === "schedule" ? null : "schedule")}/><button type="button" className="schedule-preview-pdf" title="Download Schedule Preview PDF" aria-label="Download Schedule Preview PDF" disabled={pdfBusy || !interestRows.length} onClick={downloadSchedule}>{pdfBusy ? <span className="schedule-preview-pdf-spinner" aria-hidden="true"/> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z"/><path d="M14 3v6h6M12 12v6m-3-3 3 3 3-3"/></svg>}</button></span></div>
        {accordionOpen === "holiday" && <HolidayRules form={form} update={update} chosen={chosen} setShowHolidays={setShowHolidays} contentOnly/>}
        {accordionOpen === "schedule" && <SchedulePreview rows={interestRows} money={money} contentOnly principal={Number(form.amount || 0)} interestTotal={interestTotal} emptyMessage="Enter the flat interest details to generate the schedule."/>}
      </section>
      <footer className="clean-actions"><button type="button" onClick={() => { clearLoanDraft(); go("/loan-list"); }}>Cancel</button><button type="button" onClick={resetForm}>Reset</button><button type="submit" className="save" disabled={saving}>{saving ? "Saving..." : "Save"}</button></footer>
    </form>
    {showHolidays && <HolidayModal visibleHolidays={visibleHolidays} selectedHolidays={selectedHolidays} setSelectedHolidays={setSelectedHolidays} setShowHolidays={setShowHolidays}/>} 
  </div>;
}

function FlatInterestLoanForm({ go, resetForm, customer, setCustomer, customers, selectedLoanTypeId, setSelectedLoanTypeId, loanTypes, form, update, interestPercentage, setInterestPercentage, periodic, periodicName, allowed, choosePeriodic, interestDuration, setInterestDuration, interestDurationUnit, setInterestDurationUnit, interestWeekday, setInterestWeekday, interestDate, setInterestDate, interestMonth, setInterestMonth, detailsOpen, setDetailsOpen, schedulePreviewOpen, setSchedulePreviewOpen, interestRows, interestEndDate, interestTotal, interestValue, interestInstallment, interestCount, money, saveLoan, error, saving, id, chosen, visibleHolidays, selectedHolidays, setSelectedHolidays, showHolidays, setShowHolidays }) {
  return <div className="exact-loan-page flat-interest-page">
    <header className="exact-header"><PageBreadcrumb root="Transactions" current="Loan Application" onBack={() => go("/loan-list")} /><strong>LOAN TYPE: INTEREST</strong></header>
    {error && <div className="exact-error">{error}</div>}
    <form className="exact-workspace flat-interest-workspace" onSubmit={saveLoan}>
      <section className="exact-panel exact-left interest-loan-details">
        <PanelTitle icon="" title="Loan Details"/>
        <div className="exact-two"><Field label="Customer" required><select value={customer} onChange={event => setCustomer(event.target.value)}><option value="">Select Customer</option>{customers.map(item => <option key={item.id} value={item.id}>{item.full_name || item.name}</option>)}</select></Field><Field label="Loan Type" required><select value={selectedLoanTypeId} onChange={event => setSelectedLoanTypeId(String(event.target.value))}><option value="">Select Loan Type</option>{loanTypes.map(item => <option key={item.id} value={String(item.id)}>{item.name || item.loan_type_name}</option>)}</select></Field></div>
        <div className="flat-interest-card">
          <h3>Flat Interest Details</h3>
          <div className="exact-fields interest-input-row flat-interest-primary"><Field label="Principal Amount" required><input type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" value={form.amount} onChange={event => update("amount", event.target.value)}/></Field><Field label="Interest Percentage" required><div className="percent-input"><input type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" value={interestPercentage} onChange={event => setInterestPercentage(event.target.value)}/><b>%</b></div></Field></div>
          <button type="button" className="loan-schedule-details-toggle schedule-section-header" onClick={() => setDetailsOpen(value => !value)} aria-expanded={detailsOpen}>Loan Schedule Details <span aria-hidden="true">{detailsOpen ? "▲" : "▼"}</span></button>
          {detailsOpen && <div className="flat-interest-expanded">
            <div className="flat-calculated-grid schedule-summary"><Calculated label="Interest Amount" value={money(interestValue)}/><Calculated label="Total Payable" value={money(interestTotal)}/><Calculated label="Total Installments" value={interestCount || "-"}/></div>
            <div className="exact-fields duration-row loan-schedule-fields"><Field label="Duration Type"><select value={interestDurationUnit} onChange={event => setInterestDurationUnit(event.target.value)}><option value="DAY">Days</option><option value="WEEK">Weeks</option><option value="MONTH">Months</option><option value="YEAR">Years</option></select></Field><Field label="Duration" required><input type="number" min="1" inputMode="numeric" value={interestDuration} onChange={event => setInterestDuration(event.target.value)}/></Field><Field label="Start Date" required><LoanDateInput value={form.startDate} onChange={value => update("startDate", value)}/></Field><Calculated label="Unit Installment Amount" value={money(interestInstallment)}/><Calculated label="Round-off Date" value={interestEndDate ? formatDate(interestEndDate) : "-"}/></div>
          </div>}
        </div>
        <div className="exact-field-label">Collection Plan <i>*</i></div>
        <div className="exact-periodics">{allowed.map(item => <button type="button" key={item.id} title={item.name} className={Number(periodic) === Number(item.id) ? "selected" : ""} onClick={() => choosePeriodic(item.id)}><b>{periodicLetters[item.name] || item.name.slice(0, 1)}</b><small>{item.name}</small></button>)}</div>
        {periodicName === "Weekly" && <div className="interest-schedule-field"><b>Collection Day <i>*</i></b><div className="interest-weekdays">{weekdays.map(([letter, name], index) => <button type="button" title={name} className={interestWeekday === index ? "selected" : ""} onClick={() => setInterestWeekday(index)} key={`${name}-${index}`}>{letter}</button>)}</div></div>}
        {periodicName === "Monthly" && <Field label="Collection Date" required><select value={interestDate} onChange={event => setInterestDate(event.target.value)}>{Array.from({ length: 31 }, (_, index) => <option value={index + 1} key={index + 1}>{index + 1}</option>)}</select></Field>}
        {periodicName === "Annual" && <div className="interest-annual-fields"><Field label="Collection Month" required><select value={interestMonth} onChange={event => setInterestMonth(event.target.value)}>{Array.from({ length: 12 }, (_, index) => <option value={index + 1} key={index + 1}>{new Date(2000, index, 1).toLocaleString("en-IN", { month: "long" })}</option>)}</select></Field><Field label="Collection Date" required><select value={interestDate} onChange={event => setInterestDate(event.target.value)}>{Array.from({ length: 31 }, (_, index) => <option value={index + 1} key={index + 1}>{index + 1}</option>)}</select></Field></div>}
        <HolidayRules form={form} update={update} chosen={chosen} setShowHolidays={setShowHolidays}/>
      </section>
      <SchedulePreview rows={interestRows} money={money} open={schedulePreviewOpen} onToggle={() => setSchedulePreviewOpen(value => !value)} principal={Number(form.amount || 0)} interestTotal={interestTotal} emptyMessage="Enter the flat interest details to generate the schedule."/>
      <footer className="exact-actions"><button type="button" onClick={() => go("/loan-list")}>Cancel</button><button type="button" onClick={resetForm}>Reset</button><button type="submit" className="save" disabled={saving}>{saving ? "Saving..." : "Save"}</button></footer>
    </form>
    {showHolidays && <HolidayModal visibleHolidays={visibleHolidays} selectedHolidays={selectedHolidays} setSelectedHolidays={setSelectedHolidays} setShowHolidays={setShowHolidays}/>} 
  </div>;
}

function AccordionControl({ label, open, onToggle }) { return <button type="button" className={`loan-accordion-toggle ${open ? "active" : ""}`} onClick={onToggle} aria-expanded={open}><span>{label}</span><span aria-hidden="true">{open ? "▴" : "▾"}</span></button>; }

function SchedulePreview({ rows, isChit = false, money, principal = 0, interestTotal = 0, totalAmount = 0, emptyMessage, open = true, onToggle, contentOnly = false }) {
  const [activeIndex, setActiveIndex] = useState(-1);
  const rowRefs = useRef([]);
  useEffect(() => { setActiveIndex(-1); rowRefs.current = []; }, [rows.length, isChit]);
  const tableRows = rows.map((row, index) => {
    const amount = Number(row.amount || row.installment_amount || 0);
    if (isChit) {
      const paid = rows.slice(0, index + 1).reduce((sum, item) => sum + Number(item.amount || item.installment_amount || 0), 0);
      return { number: row.installment_number || index + 1, schedule: row.schedule_value, date: row.due_date, amount, paid, balance: Math.max(0, totalAmount - paid) };
    }
    const principalPart = index === rows.length - 1 ? principal - (principal / (rows.length || 1)) * index : principal / (rows.length || 1);
    const interestPart = amount - principalPart;
    const paidPrincipal = principalPart * (index + 1);
    return { number: row.installment_number || index + 1, date: row.due_date, principal: principalPart, interest: interestPart, amount, balance: Math.max(0, principal - paidPrincipal), interestTotal };
  });
  const move = (event, direction) => {
    if (!tableRows.length) return;
    event.preventDefault();
    const current = activeIndex < 0 ? (direction > 0 ? 0 : tableRows.length - 1) : activeIndex;
    const next = Math.max(0, Math.min(tableRows.length - 1, current + direction));
    setActiveIndex(next);
    rowRefs.current[next]?.scrollIntoView({ block: "nearest" });
  };
  const onKeyDown = event => {
    if (event.key === "ArrowDown") move(event, 1);
    else if (event.key === "ArrowUp") move(event, -1);
    else if (event.key === "Home") { event.preventDefault(); setActiveIndex(0); rowRefs.current[0]?.scrollIntoView({ block: "nearest" }); }
    else if (event.key === "End") { event.preventDefault(); const last = tableRows.length - 1; setActiveIndex(last); rowRefs.current[last]?.scrollIntoView({ block: "nearest" }); }
    else if (event.key === "PageDown") move(event, 5);
    else if (event.key === "PageUp") move(event, -5);
  };
  return <section className={`exact-panel exact-right schedule-preview ${contentOnly ? "accordion-content-panel" : ""}`}>{!contentOnly && <button type="button" className="schedule-section-header schedule-preview-toggle" onClick={onToggle} aria-expanded={open}><span>Schedule Preview</span><span aria-hidden="true">{open ? "▲" : "▼"}</span></button>}{open && <div className="schedule-preview-body" tabIndex={0} onKeyDown={onKeyDown} aria-label="Schedule Preview"><table className={`exact-table schedule-table schedule-preview-table ${isChit ? "chit" : "interest"}`}><thead><tr>{isChit ? <><th>S.NO</th><th>SCHEDULE</th><th>SCHEDULE DATE</th><th>INSTALLMENT AMOUNT</th><th>TOTAL PAID</th><th>BALANCE</th></> : <><th>S.NO</th><th>INSTALLMENT DATE</th><th>PRINCIPAL</th><th>INTEREST</th><th>INSTALLMENT AMOUNT</th><th>BALANCE</th></>}</tr></thead><tbody>{tableRows.map((row, index) => <tr ref={node => { rowRefs.current[index] = node; }} className={index === activeIndex ? "active-row" : ""} onClick={() => { setActiveIndex(index); rowRefs.current[index]?.focus(); }} tabIndex={-1} key={`${row.number}-${row.date}-${index}`}><td>{row.number}</td>{isChit && <td>{row.schedule ?? "-"}</td>}<td>{formatDate(row.date)}</td>{isChit ? <><td className="currency">{money(row.amount)}</td><td className="currency">{money(row.paid)}</td><td className="currency">{money(row.balance)}</td></> : <><td className="currency">{money(row.principal)}</td><td className="currency">{money(row.interest)}</td><td className="currency">{money(row.amount)}</td><td className="currency">{money(row.balance)}</td></>}</tr>)}</tbody>{!isChit && <tfoot><tr><th colSpan="2">Grand Total</th>{!isChit && <><th>{money(tableRows.reduce((sum, row) => sum + row.principal, 0))}</th><th>{money(tableRows.reduce((sum, row) => sum + row.interest, 0))}</th></>}<th>{money(tableRows.reduce((sum, row) => sum + row.amount, 0))}</th><td/></tr></tfoot>}</table>{!tableRows.length && <div className="exact-empty schedule-empty-state">{emptyMessage}</div>}</div>}</section>;
}

function LegacyFlatInterestLoanForm({ go, resetForm, customer, setCustomer, customers, selectedLoanTypeId, setSelectedLoanTypeId, loanTypes, form, update, interestPercentage, setInterestPercentage, periodic, periodicName, allowed, choosePeriodic, interestDuration, setInterestDuration, interestDurationUnit, setInterestDurationUnit, interestWeekday, setInterestWeekday, interestDate, setInterestDate, interestMonth, setInterestMonth, detailsOpen, setDetailsOpen, interestRows, interestEndDate, interestTotal, interestValue, interestInstallment, interestCount, interestDurationLabel, money, saveLoan, error, saving, id, chosen, visibleHolidays, selectedHolidays, setSelectedHolidays, showHolidays, setShowHolidays }) {
  const rows = interestRows;
  return <div className="exact-loan-page flat-interest-page">
    <header className="exact-header"><PageBreadcrumb root="Transactions" current="Loan Application" onBack={() => go("/loan-list")} /><strong>LOAN TYPE: INTEREST</strong></header>
    {error && <div className="exact-error">{error}</div>}
    <form className="exact-workspace flat-interest-workspace" onSubmit={saveLoan}>
      <section className="exact-panel exact-left interest-loan-details">
        <PanelTitle icon="" title="Loan Details"/>
        <div className="exact-two"><Field label="Customer" required><select value={customer} onChange={event => setCustomer(event.target.value)}><option value="">Select Customer</option>{customers.map(item => <option key={item.id} value={item.id}>{item.full_name || item.name}</option>)}</select></Field><Field label="Loan Type" required><select value={selectedLoanTypeId} onChange={event => setSelectedLoanTypeId(String(event.target.value))}><option value="">Select Loan Type</option>{loanTypes.map(item => <option key={item.id} value={String(item.id)}>{item.name || item.loan_type_name}</option>)}</select></Field></div>
        <div className="exact-field-label">Collection Plan <i>*</i></div>
        <div className="exact-periodics">{allowed.map(item => <button type="button" key={item.id} title={item.name} className={Number(periodic) === Number(item.id) ? "selected" : ""} onClick={() => choosePeriodic(item.id)}><b>{periodicLetters[item.name] || item.name.slice(0, 1)}</b><small>{item.name}</small></button>)}</div>
        {periodicName === "Weekly" && <div className="interest-schedule-field"><b>Collection Day <i>*</i></b><div className="interest-weekdays">{weekdays.map(([letter, name], index) => <button type="button" title={name} className={interestWeekday === index ? "selected" : ""} onClick={() => setInterestWeekday(index)} key={`${name}-${index}`}>{letter}</button>)}</div></div>}
        {periodicName === "Monthly" && <Field label="Collection Date" required><select value={interestDate} onChange={event => setInterestDate(event.target.value)}>{Array.from({ length: 31 }, (_, index) => <option value={index + 1} key={index + 1}>{index + 1}</option>)}</select></Field>}
        {periodicName === "Annual" && <div className="interest-annual-fields"><Field label="Collection Month" required><select value={interestMonth} onChange={event => setInterestMonth(event.target.value)}>{Array.from({ length: 12 }, (_, index) => <option value={index + 1} key={index + 1}>{new Date(2000, index, 1).toLocaleString("en-IN", { month: "long" })}</option>)}</select></Field><Field label="Collection Date" required><select value={interestDate} onChange={event => setInterestDate(event.target.value)}>{Array.from({ length: 31 }, (_, index) => <option value={index + 1} key={index + 1}>{index + 1}</option>)}</select></Field></div>}
        <div className="flat-interest-card">
          <h3>Flat Interest Details</h3>
          <div className="exact-fields interest-input-row flat-interest-primary"><Field label="Principal Amount" required><input type="number" min="0" step="0.01" inputMode="decimal" placeholder="₹0.00" value={form.amount} onChange={event => update("amount", event.target.value)}/></Field><Field label="Interest Percentage" required><div className="percent-input"><input type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" value={interestPercentage} onChange={event => setInterestPercentage(event.target.value)}/><b>%</b></div></Field></div>
          <button type="button" className="loan-schedule-details-toggle" onClick={() => setDetailsOpen(value => !value)} aria-expanded={detailsOpen}>Loan Schedule Details <span aria-hidden="true">{detailsOpen ? "▲" : "▼"}</span></button>
          {detailsOpen && <div className="flat-interest-expanded"><div className="exact-fields duration-row"><Field label="Duration" required><input type="number" min="1" inputMode="numeric" value={interestDuration} onChange={event => setInterestDuration(event.target.value)}/></Field><Field label="Duration Unit"><select value={interestDurationUnit} onChange={event => setInterestDurationUnit(event.target.value)}><option value="DAY">Days</option><option value="WEEK">Weeks</option><option value="MONTH">Months</option><option value="YEAR">Years</option></select></Field><Field label="Loan Start Date" required><LoanDateInput value={form.startDate} onChange={value => update("startDate", value)}/></Field></div><div className="flat-calculated-grid"><Calculated label="Interest Amount" value={money(interestValue)}/><Calculated label="Total Payable" value={money(interestTotal)}/><Calculated label="Total Installments" value={interestCount || "—"}/><Calculated label="Installment Amount" value={money(interestInstallment)}/><Calculated label="Loan End Date" value={interestEndDate ? formatDate(interestEndDate) : "—"}/></div></div>}
        </div>
        <HolidayRules form={form} update={update} chosen={chosen} setShowHolidays={setShowHolidays}/>
      </section>
      <section className="exact-panel exact-right"><div className="exact-panel-head"><PanelTitle icon="" title="Schedule Preview"/><em>Auto-generated</em></div><table className="exact-table"><thead><tr><th>S.NO</th><th>DUE DATE</th><th>DAY</th><th>INSTALLMENT AMOUNT</th><th>STATUS</th></tr></thead><tbody>{rows.map(row => <tr key={row.installment_number}><td>{row.installment_number}</td><td>{formatDate(row.due_date)}</td><td>{new Date(`${row.due_date}T00:00:00`).toLocaleDateString("en-US", { weekday: "short" })}</td><td>{money(row.amount)}</td><td><span className="exact-status">Upcoming</span></td></tr>)}</tbody></table>{!rows.length && <div className="exact-empty">Enter the flat interest details<br/>to generate the schedule.</div>}</section>
      <footer className="exact-actions"><button type="button" onClick={() => go("/loan-list")}>Cancel</button><button type="button" onClick={resetForm}>Reset</button><button type="submit" className="save" disabled={saving}>{saving ? "Saving…" : "Save"}</button></footer>
    </form>
    {showHolidays && <HolidayModal visibleHolidays={visibleHolidays} selectedHolidays={selectedHolidays} setSelectedHolidays={setSelectedHolidays} setShowHolidays={setShowHolidays}/>} 
  </div>;
}

function MortgageLoanLayout({ api, auth, applicationDate, go, resetForm, clearLoanDraft, customer, setCustomer, customers, selectedLoanTypeId, setSelectedLoanTypeId, loanTypes, mortgageProducts, mortgageProductId, setMortgageProductId, mortgageProduct, mortgageQuantity, setMortgageQuantity, form, update, mortgageMarketValue, mortgageInterest, setMortgageInterest, mortgageDailyInterest, money, saveLoan, error, saving, id, doneByStaff, setDoneByStaff }) {
  return <div className="exact-loan-page clean-loan-page is-mortgage">
    <header className="exact-header"><PageBreadcrumb root="Transactions" current="Loan Application" onBack={() => go("/loan-list")} /><ApplicationDate value={applicationDate}/></header>
    {error && <div className="exact-error">{error}</div>}
    <form onSubmit={saveLoan}>
      <section className="clean-panel"><h2>Mortgage Details</h2>
        <div className="clean-top-grid"><Field label="Customer" required><select value={customer} onChange={event => setCustomer(event.target.value)}><option value="">Select Customer</option>{customers.map(item => <option key={item.id} value={item.id}>{item.full_name || item.name}</option>)}</select></Field><Field label="Loan Type" required><select value={selectedLoanTypeId} onChange={event => setSelectedLoanTypeId(String(event.target.value))}><option value="">Select Loan Type</option>{loanTypes.map(item => <option key={item.id} value={String(item.id)}>{item.name || item.loan_type_name}</option>)}</select></Field><Field label="Done By" required><StaffDropdown api={api} auth={auth} value={doneByStaff} onChange={setDoneByStaff} placeholder="Select staff" allowClear/></Field></div>
        <div className="mortgage-loan-grid"><Field label="Product Name"><select value={mortgageProductId} onChange={event => setMortgageProductId(event.target.value)}><option value="">Select Product</option>{mortgageProducts.map(item => <option key={item.id} value={item.id}>{item.product_name}</option>)}</select></Field><Field label="Quantity"><input type="number" min="0" step="0.001" inputMode="decimal" value={mortgageQuantity} onChange={event => setMortgageQuantity(event.target.value)} /></Field><Field label="Unit"><input value={mortgageProduct?.unit || ""} readOnly /></Field><Field label="Current Rate"><input value={mortgageProduct ? money(mortgageProduct.current_rate) : ""} readOnly /></Field><Field label="Market Value"><input value={mortgageMarketValue ? money(mortgageMarketValue) : ""} readOnly /></Field><Field label="Loan Amount" required><input type="number" min="0" step="0.01" inputMode="decimal" value={form.amount} onChange={event => update("amount", event.target.value)} /></Field><Field label="Rate of Interest" required><div className="percent-input"><input type="number" min="0" step="0.01" inputMode="decimal" value={mortgageInterest} onChange={event => setMortgageInterest(event.target.value)} /><b>%</b></div></Field><Calculated label="Daily Interest" value={money(mortgageDailyInterest || 0)}/></div>
      </section>
      <footer className="clean-actions"><button type="button" onClick={() => { clearLoanDraft(); go("/loan-list"); }}>Cancel</button><button type="button" onClick={resetForm}>Reset</button><button type="submit" className="save" disabled={saving}>{saving ? "Saving..." : "Save"}</button></footer>
    </form>
  </div>;
}

function HolidayRules({ form, update, chosen, setShowHolidays, contentOnly = false }) {
  return <section className={`holiday-rules-section loan-accordion ${contentOnly ? "accordion-content-panel" : ""}`}><div className="loan-accordion-content"><div className="exact-holiday-row"><div><b>Sunday Collection</b><label className="exact-toggle"><input type="checkbox" checked={form.includeSunday} onChange={event => update("includeSunday", event.target.checked)}/><span/></label><small>{form.includeSunday ? "Include Sunday in schedule" : "Exclude Sunday in schedule"}</small></div><div><b>Holiday Handling</b><select defaultValue="skip"><option value="skip">Skip Holiday &amp; Move to Next Working Day</option></select></div><div><b>Manage Holidays</b><strong className="exact-green">Selected Holidays: {chosen.length}</strong><button type="button" className="exact-manage" onClick={() => setShowHolidays(true)}>Manage Holidays</button></div></div></div></section>;
}

function HolidayModal({ visibleHolidays, selectedHolidays, setSelectedHolidays, setShowHolidays }) {
  return <div className="exact-overlay" onMouseDown={event => event.target === event.currentTarget && setShowHolidays(false)}><div className="exact-holiday-modal"><div><h2>Manage Holidays</h2><button type="button" onClick={() => setShowHolidays(false)}>×</button></div>{visibleHolidays.map(item => <label key={item.id} className={selectedHolidays.includes(item.id) ? "included" : ""}><input type="checkbox" checked={selectedHolidays.includes(item.id)} onChange={() => setSelectedHolidays(current => current.includes(item.id) ? current.filter(id => id !== item.id) : [...current, item.id])}/>{item.holiday_date} <b>{item.holiday_name}</b></label>)}<button className="save" type="button" onClick={() => setShowHolidays(false)}>Apply</button></div></div>;
}

function FlatInterestForm({ go, resetForm, customer, setCustomer, customers, selectedLoanTypeId, setSelectedLoanTypeId, loanTypes, form, update, interestPercentage, setInterestPercentage, periodic, periodicName, allowed, choosePeriodic, interestDuration, setInterestDuration, interestDurationUnit, setInterestDurationUnit, interestWeekday, setInterestWeekday, interestDate, setInterestDate, interestMonth, setInterestMonth, detailsOpen, setDetailsOpen, interestRows, interestEndDate, interestTotal, interestValue, interestInstallment, interestCount, interestDurationLabel, money, saveLoan, error, saving, id }) {
  const rows = interestRows.slice(0, 10);
  return <div className="exact-loan-page flat-interest-page"><header className="exact-header"><PageBreadcrumb root="LOANS" current="LOAN APPLICATION" onBack={() => go("/loan-list")} /><strong>LOAN TYPE: INTEREST</strong></header>{error && <div className="exact-error">{error}</div>}<form className="exact-workspace flat-interest-workspace" onSubmit={saveLoan}><section className="exact-panel exact-left"><PanelTitle icon="◈" title="Loan Details"/><div className="exact-two"><Field label="Customer" required><select value={customer} onChange={event => setCustomer(event.target.value)}><option value="">Select Customer</option>{customers.map(item => <option key={item.id} value={item.id}>{item.full_name || item.name}</option>)}</select></Field><Field label="Loan Type" required><select value={selectedLoanTypeId} onChange={event => setSelectedLoanTypeId(String(event.target.value))}><option value="">Select Loan Type</option>{loanTypes.map(item => <option key={item.id} value={String(item.id)}>{item.name || item.loan_type_name}</option>)}</select></Field></div><div className="flat-interest-card"><h3>Flat Interest Details</h3><button type="button" className="loan-details-toggle" onClick={() => setDetailsOpen(value => !value)} aria-expanded={detailsOpen}>Loan Amount &amp; Schedule Details <span>{detailsOpen ? "?" : "?"}</span></button>{detailsOpen && <div className="loan-details-expanded"><div className="exact-fields interest-input-row"><Field label="Principal Amount" required><input type="number" min="0" step="0.01" placeholder="₹0.00" value={form.amount} onChange={event => update("amount", event.target.value)}/></Field><Field label="Interest Percentage" required><div className="percent-input"><input type="number" min="0" step="0.01" placeholder="12.00" value={interestPercentage} onChange={event => setInterestPercentage(event.target.value)}/><b>%</b></div><small>Flat interest rate for the loan period.</small></Field></div></div>}<div className="exact-field-label">Collection Periodicity <i>*</i></div><div className="exact-periodics">{allowed.map(item => <button type="button" key={item.id} title={item.name} className={Number(periodic) === Number(item.id) ? "selected" : ""} onClick={() => choosePeriodic(item.id)}><b>{periodicLetters[item.name] || item.name.slice(0, 1)}</b><small>{item.name}</small></button>)}</div>{periodicName === "Weekly" && <div className="interest-schedule-field"><b>Collection Day <i>*</i></b><div className="interest-weekdays">{weekdays.map(([letter, name], index) => <button type="button" title={name} className={interestWeekday === index ? "selected" : ""} onClick={() => setInterestWeekday(index)} key={`${name}-${index}`}>{letter}</button>)}</div></div>}{periodicName === "Monthly" && <Field label="Collection Date" required><select value={interestDate} onChange={event => setInterestDate(event.target.value)}>{Array.from({ length: 31 }, (_, index) => <option value={index + 1} key={index + 1}>{index + 1}</option>)}</select></Field>}{periodicName === "Annual" && <div className="interest-annual-fields"><Field label="Collection Month" required><select value={interestMonth} onChange={event => setInterestMonth(event.target.value)}>{Array.from({ length: 12 }, (_, index) => <option value={index + 1} key={index + 1}>{new Date(2000, index, 1).toLocaleString("en-IN", { month: "long" })}</option>)}</select></Field><Field label="Collection Date" required><select value={interestDate} onChange={event => setInterestDate(event.target.value)}>{Array.from({ length: 31 }, (_, index) => <option value={index + 1} key={index + 1}>{index + 1}</option>)}</select></Field></div>}{detailsOpen && <div className="loan-details-expanded"><div className="exact-fields duration-row"><Field label="Duration" required><div className="duration-input"><input type="number" min="1" value={interestDuration} onChange={event => setInterestDuration(event.target.value)}/><select value={interestDurationUnit} onChange={event => setInterestDurationUnit(event.target.value)}><option value="DAY">Days</option><option value="WEEK">Weeks</option><option value="MONTH">Months</option><option value="YEAR">Years</option></select></div></Field><Field label="Loan Start Date" required><LoanDateInput value={form.startDate} onChange={value => update("startDate", value)}/></Field></div><div className="flat-calculated-grid"><Calculated label="Interest Amount" value={money(interestValue)}/><Calculated label="Total Payable" value={money(interestTotal)}/><Calculated label="Total Installments" value={interestCount || "—"}/><Calculated label="Installment Amount" value={money(interestInstallment)}/><Calculated label="Loan End Date" value={interestEndDate ? formatDate(interestEndDate) : "—"}/></div></div>}</div></section><section className="exact-panel exact-right"><div className="exact-panel-head"><PanelTitle icon="▣" title="Schedule Preview"/><em>Auto-generated</em></div><table className="exact-table"><thead><tr><th>S.NO</th><th>DUE DATE</th><th>DAY</th><th>INSTALLMENT AMOUNT</th><th>STATUS</th></tr></thead><tbody>{rows.map(row => <tr key={row.installment_number}><td>{row.installment_number}</td><td>{formatDate(row.due_date)}</td><td>{new Date(`${row.due_date}T00:00:00`).toLocaleDateString("en-US", { weekday: "short" })}</td><td>{money(row.amount)}</td><td><span className="exact-status">Upcoming</span></td></tr>)}</tbody></table>{!rows.length && <div className="exact-empty">Enter the flat interest details<br/>to generate the schedule.</div>}</section><footer className="exact-actions"><button type="button" onClick={() => go("/loan-list")}>× &nbsp; Cancel</button><button type="button" onClick={resetForm}>↶ &nbsp; Reset</button><button type="submit" className="save" disabled={saving}>{saving ? "Saving…" : "Save"}</button></footer></form></div>;
}
function Calculated({ label, value }) { return <Field label={label}><input className="readonly calculated-value" value={value === "—" ? "" : value} readOnly/></Field>; }
function formatDate(value) { return value ? new Date(`${value}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—"; }
function buildInterestSchedule({ startDate, periodicity, duration, durationUnit, weekday, collectionDate, collectionMonth, amount, installmentAmount, includeSunday, blockedHolidays = [] }) {
  const start = new Date(`${startDate}T00:00:00`), rows = [];
  const blocked = new Set(blockedHolidays);
  const move = date => { const next = new Date(date); while ((!includeSunday && next.getDay() === 0) || blocked.has(next.toISOString().slice(0, 10)) || (periodicity !== "Daily" && periodicity !== "100 Days" && next < start)) next.setDate(next.getDate() + 1); return next; };
  for (let index = 0; index < duration; index += 1) {
    const due = new Date(start);
    if (periodicity === "Daily" || periodicity === "100 Days") due.setDate(start.getDate() + index);
    else if (periodicity === "Weekly") { const day = weekday ?? 0; due.setDate(start.getDate() + ((day + 1 - start.getDay() + 7) % 7) + index * 7); }
    else if (periodicity === "Annual" || periodicity === "Others" || periodicity === "Other") { const month = Number(collectionMonth); const day = Number(collectionDate); let year = start.getFullYear(); const first = new Date(year, month - 1, Math.min(day, new Date(year, month, 0).getDate())); if (first < start) year += 1; due.setFullYear(year + index, month - 1, Math.min(day, new Date(year + index, month, 0).getDate())); }
    else { due.setMonth(start.getMonth() + index + (Number(collectionDate) < start.getDate() ? 1 : 0), Number(collectionDate)); }
    const valid = move(due); rows.push({ installment_number: index + 1, due_date: valid.toISOString().slice(0, 10), amount: index === duration - 1 ? amount - installmentAmount * (duration - 1) : installmentAmount });
  }
  return rows;
}

function ApplicationDate({ value }) { return <div className="loan-application-date"><span>Application Date</span><strong>{value || "-"}</strong></div>; }
