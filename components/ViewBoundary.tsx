import React from "react";
/** Keep project and view navigation available if an individual screen fails. */
export class ViewBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  declare readonly props: { children: React.ReactNode };
  declare setState: (state: { failed: boolean }) => void;
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    console.error("Workspace view failed", error);
  }
  render() {
    return (
      <div className="hf-screen">
        {this.state.failed ? (
          <section role="alert" className="p-8">
            <h1 className="text-xl font-bold">This view could not load</h1>
            <p className="my-3 text-slate-600">
              Try again, or use the navigation above to open another view.
            </p>
            <button
              className="rounded-lg border bg-white px-4 py-2"
              onClick={() => this.setState({ failed: false })}
            >
              Try again
            </button>
          </section>
        ) : (
          this.props.children
        )}
      </div>
    );
  }
}
