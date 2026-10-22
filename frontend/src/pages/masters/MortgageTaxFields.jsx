import CustomSelect from "../../components/CustomSelect";
import MortgageUqcField from "./MortgageUqcField";
import "./MortgageTaxFields.css";

const TAX_RATES = [0, 5, 12, 18, 28];

// `optional` (Group Master) drops the required markers; the Product form keeps them.
// `showTax` = false (Mortgage Product) hides HSN Code / Rate of Tax, which now belong to Group & Ledger Master.
// `showUnits` = false (Group Master) hides Unit / UQC.
export default function MortgageTaxFields({ form, update, units, addUnit, uqcs, addUqc, optional = false, showTax = true, showUnits = true }) {
  const star = optional ? null : <b>*</b>;
  return <div className="mortgage-product-tax-grid">
    {showTax && <><label className="mortgage-tax-field"><span>HSN Code {star}</span>
      <input required={!optional} maxLength={30} value={form.hsn_code || ""} onChange={event => update("hsn_code", event.target.value)} />
    </label>
    <label className="mortgage-tax-field"><span>Rate of Tax (ROT) {star}</span>
      <select required={!optional} value={form.rate_of_tax ?? 0} onChange={event => update("rate_of_tax", Number(event.target.value))}>
        {TAX_RATES.map(rate => <option key={rate} value={rate}>{rate}%</option>)}
      </select>
    </label></>}
    {showUnits && <><div className="mortgage-tax-field"><span>Unit {star}</span>
      <CustomSelect key={`unit-${form.id || "new"}`} label="unit" maxLength={50} value={form.unit || ""} options={units} onChange={value => update("unit", value)} onAdd={addUnit} />
    </div>
    <MortgageUqcField value={form.uqc || ""} options={uqcs} onChange={value => update("uqc", value)} onAdd={addUqc} optional={optional} /></>}
  </div>;
}
