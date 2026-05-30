const PROFILE_HOST = "https://profile.example.com/users";

export async function getProfile(id: string): Promise<unknown> {
  const res = await fetch(`${PROFILE_HOST}/${id}`);
  return res.json();
}
