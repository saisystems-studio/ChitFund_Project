import CustomSelect from "../../components/CustomSelect";
import "./MortgageEditModal.css";

function Icon({ name }) {
  const paths = {
    product: <><path d="m12 3 9 5v9l-9 5-9-5V8l9-5Z"/><path d="m3 8 9 5 9-5M12 13v9M7.5 5.5l9 5"/></>,
    group: <><path d="M4 5h6l2 2h8v12H4V5Z"/></>,
    tag: <><path d="M3 3h8l10 10-8 8L3 11V3Z"/><circle cx="7.5" cy="7.5" r="1"/></>,
    unit: <><path d="m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5"/></>,
    rate: <path d="M6 4h12M6 8h12M8 4c8 0 8 9 0 9H6l10 8"/>,
    calendar: <><rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4M16 3v4M4 11h16"/></>,
    reset: <><path d="M4 9a9 9 0 1 1-1 6M4 3v6h6M12 7v5l4 2"/></>,
    close: <path d="m5 5 14 14M19 5 5 19"/>,
    save: <><path d="M4 3h13l4 4v14H3V3h1Z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function Field({ label, icon, required, children }) {
  return <label className="mortgage-edit-field"><span>{label}{required && <> <b className="mortgage-edit-required">*</b></>}</span><div className="mortgage-edit-control"><span className="mortgage-edit-prefix"><Icon name={icon}/></span>{children}</div></label>;
}

export default function MortgageEditModal({ api, auth, form, update, units, addUnit, productGroups, addProductGroup, resetVersion, saving, onSave, onReset, onClose }) {
  return <div className="mortgage-modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <form className="mortgage-edit-modal" role="dialog" aria-modal="true" aria-labelledby="mortgage-edit-title" onSubmit={onSave}>
      <header className="mortgage-edit-heading">
        <span className="mortgage-edit-badge"><Icon name="product"/></span>
        <div><h2 id="mortgage-edit-title">Edit Mortgage Product</h2><p>Update the product details and rate information</p></div>
        <button type="button" className="mortgage-edit-close" aria-label="Close" onClick={onClose}><Icon name="close"/></button>
      </header>
      <div className="mortgage-edit-body">
        <div className="mortgage-edit-fields">
          <Field label="Product Group" icon="group" required><CustomSelect key={`group-${form.id}-${resetVersion}`} label="product group" maxLength={50} value={form.product_group} options={productGroups} onChange={value => update("product_group", value)} onAdd={addProductGroup}/></Field>
          <Field label="Product Name" icon="tag" required><input autoFocus value={form.product_name} onChange={event => update("product_name", event.target.value)}/></Field>
          <Field label="Unit" icon="unit" required><CustomSelect key={`${form.id}-${resetVersion}`} label="unit" maxLength={50} value={form.unit} options={units} onChange={value => update("unit", value)} onAdd={addUnit}/></Field>
          <Field label="Quantity" icon="unit"><input type="number" min="0" step="0.01" value={form.quantity ?? ""} onChange={event => update("quantity", event.target.value)}/></Field>
          <Field label="Current Rate" icon="rate"><input type="number" min="0" step="0.01" inputMode="decimal" value={form.current_rate} onChange={event => update("current_rate", event.target.value)}/></Field>
          <Field label="Date" icon="calendar"><input type="date" required value={form.rate_date || ""} onChange={event => update("rate_date", event.target.value)}/></Field>
        </div>
      </div>
      <footer className="mortgage-edit-footer">
        <button type="button" onClick={onReset}><Icon name="reset"/>Reset</button>
        <button type="button" onClick={onClose}><Icon name="close"/>Cancel</button>
        <button type="submit" className="mortgage-edit-save" disabled={saving}><Icon name="save"/>{saving ? "Saving..." : "Save"}</button>
      </footer>
    </form>
  </div>;
}
