export default function Tooltip({ label, children }) {
  return <span className="icon-tooltip-wrap" data-tooltip={label}>{children}</span>;
}
