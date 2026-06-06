import { createContext, useContext, useState } from "react";
import en from "./en.js";
import zh from "./zh.js";

export type Lang = "en" | "zh";

const messages: Record<Lang, typeof en> = { en, zh };

export interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  defaultLang,
  onLangChange,
  children,
}: {
  defaultLang: Lang;
  onLangChange?: (lang: Lang) => void;
  children: React.ReactNode;
}) {
  const [lang, setLangState] = useState<Lang>(defaultLang);

  const setLang = (newLang: Lang) => {
    setLangState(newLang);
    onLangChange?.(newLang);
  };

  const t = (key: string, params?: Record<string, string | number>): string => {
    const dict = messages[lang] ?? messages.en;
    let text = dict[key as keyof typeof dict] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.replace(`{${k}}`, String(v));
      }
    }
    return text;
  };

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
