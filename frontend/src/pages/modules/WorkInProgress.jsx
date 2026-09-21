import PageBreadcrumb from "../../components/PageBreadcrumb";
import workProgressImage from "../../assets/images/work-progress.png";
import "./work-progress.css";

export default function WorkInProgress({ title, go }) {
  return <div className="work-progress-page"><PageBreadcrumb root="Reports" current={title} onBack={() => go("/dashboard")} /><main className="work-progress-content"><img src={workProgressImage} alt={`${title} - Work in Progress`} /><p>{title} is currently under development.</p></main></div>;
}
