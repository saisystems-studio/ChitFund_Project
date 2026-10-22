import { useState } from "react";
import axios from "axios";
import styles from "./Login.module.css";
import { CompanyLogo, useCompanyProfile } from "../../components/CompanyProfileContext";
import loginArt from "../../assets/images/login.png";

const FEATURES = [
  { title: "Chit Fund", text: "Group Management", icon: <path d="M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2 19c0-3 3-5 6-5s6 2 6 5M14 14.3c.6-.2 1.3-.3 2-.3 3 0 6 2 6 5" /> },
  { title: "Loan Accounts", text: "Disbursements & Repayments", icon: <path d="M3 10l9-6 9 6M5 10v8m4-8v8m6-8v8m4-8v8M3 20h18" /> },
  { title: "Interest Collection", text: "Tracking & Reports", icon: <path d="M4 20V10m6 10V4m6 16v-7m5 7H2" /> },
];

export default function Login({ onLogin }) {
  const { profile } = useCompanyProfile();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(event) {
    event.preventDefault(); setLoading(true); setError("");
    try { const baseURL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000/api"; const { data } = await axios.post(`${baseURL}/auth/login/`, { username, password }); onLogin(data); }
    catch (requestError) { setError(requestError.response?.status === 401 ? "Invalid username or password" : "Unable to sign in right now. Please try again."); }
    finally { setLoading(false); }
  }
  return (
    <main className={styles.page}>
      <section className={styles.illustration} style={{ backgroundImage: `url(${loginArt})` }}>
        <div className={styles.brandTop}>
          <p className={styles.kicker}>CHIT FUND, LOAN &amp; INTEREST MANAGEMENT</p>
          <h1>Manage Collections<br />with Confidence</h1>
          <p className={styles.subtext}>Secure, structured software for lending, chit collections and finance operations.</p>
          <ul className={styles.features}>
            {FEATURES.map(f => (
              <li key={f.title}>
                <span className={styles.featureIcon}><svg viewBox="0 0 24 24" aria-hidden="true">{f.icon}</svg></span>
                <span><strong>{f.title}</strong> – {f.text}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
      <section className={styles.formSide}>
        <div className={styles.mobileBrand}>CHIT FUND, LOAN &amp; INTEREST MANAGEMENT</div>
        <div className={styles.card}>
          <div className={styles.logo}>
            {profile.logo
              ? <CompanyLogo />
              : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10l9-6 9 6M5 10v8m4-8v8m6-8v8m4-8v8M3 20h18" /></svg>}
          </div>
          <h2>Welcome back</h2>
          <p className={styles.muted}>Sign in to your finance management workspace.</p>
          <form onSubmit={submit} autoComplete="off">
            <label>Username
              <div className={styles.field}>
                <svg className={styles.fieldIcon} viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-6 8-6s8 2 8 6" /></svg>
                <input value={username} onChange={event => setUsername(event.target.value)} autoComplete="off" placeholder="Enter your username" required />
              </div>
            </label>
            <label>Password
              <div className={styles.field}>
                <svg className={styles.fieldIcon} viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
                <input type={showPassword ? "text" : "password"} value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" placeholder="Enter your password" required />
                <button type="button" className={styles.passwordToggle} onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>
                  {showPassword
                    ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 4.2A11.7 11.7 0 0 1 12 4c5.3 0 9.4 4 10.5 8-.4 1.4-1.1 2.6-2 3.7M6.2 6.2C3.8 6.2 2.2 10 1.5 12c1.1 4 5.2 8 10.5 8 1.7 0 3.2-.4 4.5-1" /></svg>
                    : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1.5 12S5.5 4 12 4s10.5 8 10.5 8S18.5 20 12 20 1.5 12 1.5 12Z" /><circle cx="12" cy="12" r="3" /></svg>}
                </button>
              </div>
            </label>
            {error && <div className={styles.error}>{error}</div>}
            <button className={styles.submit} disabled={loading}>
              <span>{loading ? "Signing in..." : "Sign In"}</span>
              {!loading && <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>}
            </button>
          </form>
          <p className={styles.powered}>Powered by Sai Infosys</p>
        </div>
      </section>
    </main>
  );
}
