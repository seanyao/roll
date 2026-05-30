const PAYMENT_API_URL = "https://api.payments.example.com/v1/charge";

export async function charge(amount: number): Promise<Response> {
  return fetch(PAYMENT_API_URL, {
    method: "POST",
    body: JSON.stringify({ amount }),
    timeout: 5000,
  }).catch((err) => {
    console.error("payment failed, falling back", err);
    return new Response(null, { status: 502 });
  });
}
