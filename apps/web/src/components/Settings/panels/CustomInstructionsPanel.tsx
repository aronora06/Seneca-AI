import { useCallback, useState } from "react";

import { readPrefs, writePrefs } from "../../../lib/userPreferences";
import { PanelIntro, Section } from "./_shared";

const MAX_CHARS = 1500;

const ABOUT_PLACEHOLDER = `Examples:
- I'm a graduate student studying Middle Eastern energy politics
- I teach AP History at a high school in Virginia
- I'm a software engineer who prefers Python and works with AWS
- I'm a philosophy enthusiast who's been reading the Stoics`;

const RESPOND_PLACEHOLDER = `Examples:
- Use Socratic questioning rather than giving me answers directly
- Always cite sources when making factual claims
- Keep responses under 3 paragraphs unless I ask for more
- When discussing code, show examples in Python
- Challenge my assumptions — don't just agree with me`;

export function CustomInstructionsPanel() {
  const initial = readPrefs().customInstructions;
  const [aboutYou, setAboutYou] = useState(initial.aboutYou);
  const [howToRespond, setHowToRespond] = useState(initial.howToRespond);

  const saveAbout = useCallback((val: string) => {
    const clamped = val.slice(0, MAX_CHARS);
    setAboutYou(clamped);
    writePrefs({ customInstructions: { aboutYou: clamped } });
  }, []);

  const saveRespond = useCallback((val: string) => {
    const clamped = val.slice(0, MAX_CHARS);
    setHowToRespond(clamped);
    writePrefs({ customInstructions: { howToRespond: clamped } });
  }, []);

  return (
    <>
      <PanelIntro
        description="Tell Seneca about yourself and how you'd like him to respond. These instructions apply to every conversation."
        autoSaves
      />

      <Section label="About you" hint="What should Seneca know about you?">
        <textarea
          value={aboutYou}
          onChange={(e) => saveAbout(e.target.value)}
          placeholder={ABOUT_PLACEHOLDER}
          rows={5}
          maxLength={MAX_CHARS}
          className="input resize-none"
        />
        <CharCount current={aboutYou.length} max={MAX_CHARS} />
      </Section>

      <Section
        label="How Seneca should respond"
        hint="How would you like Seneca to behave?"
      >
        <textarea
          value={howToRespond}
          onChange={(e) => saveRespond(e.target.value)}
          placeholder={RESPOND_PLACEHOLDER}
          rows={5}
          maxLength={MAX_CHARS}
          className="input resize-none"
        />
        <CharCount current={howToRespond.length} max={MAX_CHARS} />
      </Section>
    </>
  );
}

function CharCount(props: { current: number; max: number }) {
  const pct = props.current / props.max;
  return (
    <p
      className={`mt-1 text-right text-[10px] ${
        pct > 0.9 ? "text-danger" : "text-fg-subtle"
      }`}
    >
      {props.current} / {props.max}
    </p>
  );
}
