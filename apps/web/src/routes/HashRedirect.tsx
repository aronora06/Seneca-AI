import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

/** Migrate legacy `#privacy` / `#terms` URLs to path-based routes. */
export function HashRedirect() {
  const navigate = useNavigate();

  useEffect(() => {
    const hash = window.location.hash.replace(/^#\/?/, "").toLowerCase();
    if (hash === "privacy") {
      navigate("/privacy", { replace: true });
    } else if (hash === "terms" || hash === "tos") {
      navigate("/terms", { replace: true });
    }
  }, [navigate]);

  return null;
}
