import { OrderState } from "../state/types";

export function getStatusLabel(state: OrderState): string {
  switch (state) {
    case OrderState.Pending:
      return "待处理";
    case OrderState.Processing:
      return "处理中";
    case OrderState.Shipped:
      return "已发货";
    case OrderState.Delivered:
      return "已送达";
    case OrderState.Cancelled:
      return "已取消";
  }
}
