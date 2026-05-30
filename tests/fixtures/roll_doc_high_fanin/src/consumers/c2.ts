import { log } from "../shared/logger";
import { fmt } from "../shared/format";
export const c2 = () => { log(fmt(2)); };
import { once } from "../rare/once";
export const r2 = once();
