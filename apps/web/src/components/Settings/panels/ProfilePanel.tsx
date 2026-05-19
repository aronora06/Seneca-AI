import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../../../auth/AuthProvider";
import { readPrefs, writePrefs } from "../../../lib/userPreferences";
import { PanelIntro, Section } from "./_shared";

export function ProfilePanel() {
  const navigate = useNavigate();
  const { user, signOut, bypass } = useAuth();
  const [displayName, setDisplayName] = useState(() => readPrefs().displayName);

  const handleNameChange = useCallback((val: string) => {
    setDisplayName(val);
    writePrefs({ displayName: val });
  }, []);

  return (
    <>
      <PanelIntro
        description="Account info Seneca knows about. Display name updates the header avatar in real time."
        autoSaves
      />

      <Section
        label="Display name"
        hint="Used in the header and by Seneca when greeting you."
      >
        <input
          type="text"
          value={displayName}
          onChange={(e) => handleNameChange(e.target.value)}
          placeholder="How Seneca should address you"
          maxLength={60}
          className="input max-w-sm"
        />
      </Section>

      <Section label="Email" hint="Managed through your authentication provider.">
        <p className="text-sm text-fg-muted">{user?.email ?? "dev@local"}</p>
      </Section>

      {!bypass && (
        <div className="border-t border-border pt-4">
          <button
            type="button"
            onClick={() => {
              void signOut().then(() => {
                navigate("/login", { replace: true });
              });
            }}
            className="btn-soft text-danger"
          >
            Sign out
          </button>
        </div>
      )}
    </>
  );
}
