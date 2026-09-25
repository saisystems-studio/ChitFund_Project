import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import axios from "axios";

const CompanyProfileContext = createContext(null);
const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || "http://127.0.0.1:8000/api" });
const endpoint = "/auth/company-profile/";

export function CompanyProfileProvider({ children }) {
  const [profile, setProfile] = useState({ company_name: "", logo: "" });
  const revision = useRef(0);
  const defaultTitle = useRef(document.title);
  const refreshProfile = useCallback(async () => {
    const request = ++revision.current;
    const { data } = await api.get(endpoint);
    if (request === revision.current) setProfile(data);
    return data;
  }, []);
  const saveProfile = async (formData, token) => {
    const { data } = await api.patch(endpoint, formData, { headers: { Authorization: `Token ${token}` } });
    ++revision.current;
    setProfile(data);
    return data;
  };
  useEffect(() => { refreshProfile().catch(() => {}); }, [refreshProfile]);
  useEffect(() => { document.title = profile.company_name || defaultTitle.current; }, [profile.company_name]);
  return <CompanyProfileContext.Provider value={{ profile, refreshProfile, saveProfile }}>{children}</CompanyProfileContext.Provider>;
}

export const useCompanyProfile = () => useContext(CompanyProfileContext);

export function CompanyLogo() {
  const { profile } = useCompanyProfile();
  return profile.logo ? <img src={profile.logo} alt="Company logo" style={{ width: "100%", height: "100%", objectFit: "contain", display: "block", borderRadius: "inherit" }} /> : "FC";
}
