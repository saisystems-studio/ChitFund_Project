import { useState } from "react";
import axios from "axios";
import styles from "./Login.module.css";

export default function Login({ onLogin }) {
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
  return <main className={styles.page}><section className={styles.illustration}><div className={styles.logo}>FC</div><p className={styles.kicker}>FINANCE OPERATIONS</p><h1>Control every collection<br />with confidence.</h1><p className={styles.subtext}>A calm, structured workspace for your lending and collection business.</p><div className={styles.orbit}><span>₹</span><span>✓</span><span>+</span></div></section><section className={styles.card}><div className={styles.mobileLogo}>FC</div><p className={styles.kicker}>WELCOME BACK</p><h2>Sign in to Finance</h2><p className={styles.muted}>Use your account to continue.</p><form onSubmit={submit} autoComplete="off"><label>Username<input value={username} onChange={event => setUsername(event.target.value)} autoComplete="off" required /></label><label>Password<div className={styles.passwordField}><input type={showPassword ? "text" : "password"} value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" required /><button type="button" className={styles.passwordToggle} onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 4.2A11.7 11.7 0 0 1 12 4c5.3 0 9.4 4 10.5 8-.4 1.4-1.1 2.6-2 3.7M6.2 6.2C3.8 6.2 2.2 10 1.5 12c1.1 4 5.2 8 10.5 8 1.7 0 3.2-.4 4.5-1" /></svg> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1.5 12S5.5 4 12 4s10.5 8 10.5 8S18.5 20 12 20 1.5 12 1.5 12Z" /><circle cx="12" cy="12" r="3" /></svg>}</button></div></label>{error && <div className={styles.error}>{error}</div>}<button disabled={loading}>{loading ? "Signing in..." : "Sign in"}</button></form></section></main>;
}
