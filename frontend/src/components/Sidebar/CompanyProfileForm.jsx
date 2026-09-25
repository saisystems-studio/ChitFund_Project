import { useEffect, useRef, useState } from "react";
import { useCompanyProfile } from "../CompanyProfileContext";
import { actionToast } from "../../utils/actionToast";
import styles from "./Sidebar.module.css";

export default function CompanyProfileForm({ user, token }) {
  const { refreshProfile, saveProfile } = useCompanyProfile();
  const [name, setName] = useState("");
  const [contact, setContact] = useState({ address: "", phone: "", email: "" });
  const setContactField = (key, value) => setContact(current => ({ ...current, [key]: value }));
  const contactOf = data => ({ address: data.address || "", phone: data.phone || "", email: data.email || "" });
  const [savedLogo, setSavedLogo] = useState("");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState("");
  const [removeLogo, setRemoveLogo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const input = useRef(null);
  const canEdit = Boolean(user?.is_admin && token);

  useEffect(() => {
    let active = true;
    refreshProfile().then(data => {
      if (active) { setName(data.company_name); setContact(contactOf(data)); setSavedLogo(data.logo); setLoading(false); }
    }).catch(() => { if (active) setError("Unable to load Company Profile. Close Settings and try again."); });
    return () => { active = false; };
  }, [refreshProfile]);

  useEffect(() => {
    if (!file) { setPreview(""); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const chooseLogo = event => {
    const next = event.target.files?.[0];
    event.target.value = "";
    if (!next) return;
    if (!/\.(png|jpe?g)$/i.test(next.name) || (next.type && !["image/png", "image/jpeg"].includes(next.type))) {
      setError("Choose a PNG, JPG or JPEG image."); return;
    }
    if (next.size > 2 * 1024 * 1024) { setError("Logo must be 2 MB or smaller."); return; }
    setError(""); setFile(next); setRemoveLogo(false);
  };

  const save = async event => {
    event.preventDefault();
    if (!canEdit || loading || saving) return;
    setSaving(true); setError("");
    const data = new FormData();
    data.append("company_name", name.trim());
    for (const [key, value] of Object.entries(contact)) data.append(key, value.trim());
    if (file) data.append("logo", file);
    if (removeLogo) data.append("remove_logo", "true");
    try {
      const saved = await saveProfile(data, token);
      setName(saved.company_name); setContact(contactOf(saved)); setSavedLogo(saved.logo); setFile(null); setRemoveLogo(false);
      actionToast("Company Profile saved successfully.");
    } catch (failure) {
      const details = failure.response?.data;
      const message = [details?.company_name, details?.address, details?.phone, details?.email, details?.logo, details?.non_field_errors, details?.detail].filter(Boolean).flat().join(" ") || "Unable to save Company Profile. Please try again.";
      setError(message); actionToast(message, false);
    } finally { setSaving(false); }
  };
  const displayedLogo = preview || (removeLogo ? "" : savedLogo);
  return <form className={styles.companyProfile} onSubmit={save} aria-label="Company Profile">
    <b>Company Profile</b>
    {loading && !error && <p>Loading Company Profile...</p>}
    <label>Company Name<input value={name} maxLength={200} disabled={!canEdit || loading || saving} onChange={event => setName(event.target.value)} /></label>
    <label>Address<textarea rows="2" value={contact.address} maxLength={500} disabled={!canEdit || loading || saving} onChange={event => setContactField("address", event.target.value)} /></label>
    <label>Phone<input type="tel" value={contact.phone} maxLength={50} disabled={!canEdit || loading || saving} onChange={event => setContactField("phone", event.target.value)} /></label>
    <label>Email<input type="email" value={contact.email} maxLength={254} disabled={!canEdit || loading || saving} onChange={event => setContactField("email", event.target.value)} /></label>
    <label htmlFor="company-logo">Company Logo</label>
    <div className={styles.logoPreview}>{displayedLogo ? <img src={displayedLogo} alt="Company logo preview" onError={() => { setFile(null); setError("Choose a valid PNG, JPG or JPEG image."); }} /> : <span>FC</span>}</div>
    <input ref={input} id="company-logo" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" className={styles.logoInput} disabled={!canEdit || loading || saving} onChange={chooseLogo} />
    <small>PNG/JPG/JPEG, up to 2 MB and 4096 × 4096 pixels. Empty values use the current defaults.</small>
    {canEdit && <div className={styles.logoActions}>
      <button type="button" disabled={loading || saving} onClick={() => input.current?.click()}>{displayedLogo ? "Change Logo" : "Upload Logo"}</button>
      {displayedLogo && <button type="button" disabled={loading || saving} onClick={() => { setFile(null); setRemoveLogo(true); setError(""); }}>Remove Logo</button>}
    </div>}
    {!canEdit && <small>Only administrators can change the Company Profile.</small>}
    {error && <div className="alert" role="alert">{error}</div>}
    {canEdit && <div className={styles.popupActions}><button className={styles.saveButton} disabled={loading || saving}>{saving ? "Saving..." : "Save"}</button></div>}
  </form>;
}
