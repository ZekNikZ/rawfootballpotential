export async function getConfig() {
  const res = await fetch("http://localhost:8000/config");
  return await res.json();
}
