import { OrderState } from "../state/types";

export function renderStatusBadge(state: OrderState): string {
  if (state === OrderState.Delivered) {
    return "✅ 已完成";
  }
  if (state === OrderState.Cancelled) {
    return "❌ 已取消";
  }
  return "⏳ 进行中";
}
