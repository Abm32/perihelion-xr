// Dev-only: clear saved progress and reload.
export default async function run({ frame }) {
  await frame.evaluate(() => localStorage.removeItem('perihelion.v1'));
  await frame.evaluate(() => location.reload()).catch(() => {});
  await new Promise((r) => setTimeout(r, 4000));
  return 'reset';
}
