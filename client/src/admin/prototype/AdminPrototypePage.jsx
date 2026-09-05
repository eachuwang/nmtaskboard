import { useEffect, useReducer, useRef, useState } from "react";
import { toast } from "../../lib/toast.js";
import PrototypeSwitcher, { readPrototypeVariant } from "./PrototypeSwitcher.jsx";
import VariantA, { VARIANT_A_NAME } from "./VariantA.jsx";
import VariantB, { VARIANT_B_NAME } from "./VariantB.jsx";
import VariantC, { VARIANT_C_NAME } from "./VariantC.jsx";
import { PasswordDialog } from "./ProtoChrome.jsx";
import { INITIAL_ADMIN_STATE, reduceAdmin } from "./usePrototypeAdminState.js";
import "./prototype.css";

const VARIANTS = [
  { key: "A", name: VARIANT_A_NAME },
  { key: "B", name: VARIANT_B_NAME },
  { key: "C", name: VARIANT_C_NAME }
];

export default function AdminPrototypePage() {
  const keys = VARIANTS.map((item) => item.key);
  const [variant, setVariant] = useState(() => readPrototypeVariant(keys));
  const [tab, setTab] = useState("review");
  const [state, dispatch] = useReducer(reduceAdmin, INITIAL_ADMIN_STATE);
  const [showDebug, setShowDebug] = useState(false);
  const lastToast = useRef("");

  useEffect(() => {
    const sync = () => setVariant(readPrototypeVariant(keys));
    window.addEventListener("hashchange", sync);
    if (!window.location.hash.includes("variant=")) history.replaceState(null, "", "#/prototype/admin?variant=B");
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  useEffect(() => {
    if (!state.lastAction || state.lastAction === lastToast.current) return;
    lastToast.current = state.lastAction;
    toast(state.lastAction);
  }, [state.lastAction]);

  return (
    <>
      {variant === "A" && <VariantA state={state} dispatch={dispatch} tab={tab} onNav={setTab} />}
      {variant === "B" && <VariantB state={state} dispatch={dispatch} tab={tab} onNav={setTab} />}
      {variant === "C" && <VariantC state={state} dispatch={dispatch} tab={tab} onNav={setTab} />}
      
      <PasswordDialog revealed={state.revealedPassword} onDismiss={() => dispatch({ type: "dismiss-password" })} />

      <button
        type="button"
        className="proto-debug-toggle"
        onClick={() => setShowDebug(!showDebug)}
      >
        {showDebug ? "收起状态" : "查看原型状态"}
      </button>

      {showDebug && (
        <div className="proto-debug-drawer">
          <pre style={{ margin: 0 }}>
            {JSON.stringify({ variant, tab, lastAction: state.lastAction, pending: state.pending, users: state.users, llm: state.llm }, null, 2)}
          </pre>
        </div>
      )}

      <PrototypeSwitcher variants={VARIANTS} current={variant} />
    </>
  );
}
