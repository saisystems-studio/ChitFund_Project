import CollectionEntry from "./CollectionEntry";

export default function CollectionEntryTabs({ api, auth, go }) {
  return <div className="ce-fill"><CollectionEntry api={api} auth={auth} go={go}/></div>;
}
