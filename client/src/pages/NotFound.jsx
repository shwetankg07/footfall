import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <main className="empty" style={{ minHeight: "70vh", alignContent: "center" }}>
      <h1>Page not found</h1>
      <p>That address doesn't match anything in Footfall.</p>
      <Link className="btn" to="/">Go home</Link>
    </main>
  );
}
