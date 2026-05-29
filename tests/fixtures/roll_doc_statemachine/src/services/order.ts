import { OrderState } from "../state/types";

export function processOrder(status: OrderState): OrderState {
  if (status === OrderState.Pending) {
    return OrderState.Processing;
  }
  if (status === OrderState.Processing) {
    return OrderState.Shipped;
  }
  return status;
}
