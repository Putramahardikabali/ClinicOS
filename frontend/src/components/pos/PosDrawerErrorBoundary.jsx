import { Component } from "react";

export default class PosDrawerErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error("[pos-drawer]", error, info);
  }

  render() {
    const { error } = this.state;
    if (error) {
      return (
        <div className="p-4 space-y-3" data-testid="pos-drawer-error">
          <p className="text-sm text-[#B14A2C]">
            Something went wrong in the POS drawer. Close and reopen the drawer, or use the full POS page.
          </p>
          <button
            type="button"
            className="bl-btn-ghost text-sm"
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
