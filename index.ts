import { Settings, type ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { initLocale } from "./src/i18n";
import memoryEditor from "./src/extension";
import memoryGuidance from "./src/session";

export default function memoryExtension(pi: ExtensionAPI): void {
	initLocale(Settings.instance.getAgentDir());
	memoryEditor(pi);
	memoryGuidance(pi);
}
