/* OrderState enum — referenced by order, status, and display modules */
export enum OrderState {
  Pending = "pending",
  Processing = "processing",
  Shipped = "shipped",
  Delivered = "delivered",
  Cancelled = "cancelled",
}
