import React from 'react';import {createRoot} from 'react-dom/client';
import '../../src/styles.css';import '../../src/styles/global.css';import '../../src/styles/responsive-layout.css';import '../../src/styles/customer-shell.css';import '../../src/styles/customer-actions.css';
import Customer from '../../src/pages/customers/CustomerFormStepper.jsx';
const saves=window.qaSaves=[];const auth={headers:{Authorization:'Token qa-only'}};
const api={get:async url=>({data:url.includes('next-code')?{customer_code:'QA001'}:url.includes('/finance/groups/')?[{id:1,group_name:'Sundry Debtors',parent_group_id:null}]:[]}),post:async(url,data)=>{saves.push({url,data:data instanceof FormData?{name:data.get('file').name}:data});return{data:{id:99,full_name:data.full_name}}}};
createRoot(document.getElementById('root')).render(<div className="app-shell" style={{display:'flex'}}><aside id="qa-sidebar" style={{flex:'0 0 80px',height:'100dvh'}}>Sidebar</aside><main className="main-content"><Customer api={api} auth={auth} go={()=>{}}/></main></div>);
