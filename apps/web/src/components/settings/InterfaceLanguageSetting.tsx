import type { UiLocale } from "@t3tools/contracts/settings";

import { updateClientSettings, useClientSettings } from "../../hooks/useSettings";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const LANGUAGE_NAMES = { en: "English", "zh-CN": "简体中文" } as const;

export function InterfaceLanguageSetting() {
  const locale = useClientSettings((settings) => settings.uiLocale);
  return (
    <SettingsRow
      {...searchableSetting("interface-language")}
      description="Choose the interface language for this client. Conversations and code stay unchanged."
      control={
        <Select
          value={locale}
          onValueChange={(value: UiLocale | null) => {
            if (value) void updateClientSettings({ uiLocale: value });
          }}
        >
          <SelectTrigger aria-label="Interface language" className="w-full sm:w-40">
            <SelectValue>{LANGUAGE_NAMES[locale]}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end">
            {Object.entries(LANGUAGE_NAMES).map(([value, name]) => (
              <SelectItem key={value} value={value}>
                {name}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}
