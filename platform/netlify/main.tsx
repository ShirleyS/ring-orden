import CallerPhone from "../../apps/merchant-dashboard/CallerPhone";
import { createRoot } from "react-dom/client";
import MerchantApp from "../../apps/merchant-dashboard/App";
import CustomerForms from "../../apps/merchant-dashboard/CustomerForms";
import "../../app/globals.css";
createRoot(document.getElementById("root")!).render(
  window.location.pathname === "/integration" ? (
    <CallerPhone />
  ) : window.location.pathname === "/customer" ||
    window.location.pathname === "/customer/" ? (
    <CustomerForms />
  ) : (
    <MerchantApp />
  ),
);
