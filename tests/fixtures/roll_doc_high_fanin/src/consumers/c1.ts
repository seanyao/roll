import { log } from "../shared/logger";
import { fmt } from "../shared/format";
export const c1 = () => { log(fmt(1)); };
import { once } from "../rare/once";
export const r1 = once();
