import type {
  ChatRenderData,
  ChatRendererComponent,
  ChatRenderKind,
} from "@pig/chat-renderers";
import {
  Component,
  createContext,
  type ReactNode,
  useContext,
  useSyncExternalStore,
} from "react";
import {
  isBuiltinChatRenderer,
  rendererSnapshot,
  reportRendererError,
  selectChatRenderer,
  subscribeRenderers,
} from "./chat-renderer-registry";
import { SavedOutputContext } from "./HighlightedCode";
import { SyntaxRangesContext } from "./SyntaxText";

const BuiltinContext = createContext<ReactNode>(null);
function DefaultRenderer() {
  return useContext(BuiltinContext);
}
const NoDefault = () => null;
class ChatRendererBoundary extends Component<
  {
    children: ReactNode;
    fallback: ReactNode;
    rendererId: string;
    generation: number;
  },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    reportRendererError(this.props.rendererId, error, this.props.generation);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
/** Shared dispatch for built-ins and trusted user React components. */
export function ChatContent<K extends ChatRenderKind>({
  kind,
  data,
  builtin,
  contentKey = "",
}: {
  kind: K;
  data: ChatRenderData[K];
  builtin: ChatRendererComponent<K>;
  contentKey?: string;
}) {
  const snapshot = useSyncExternalStore(
    subscribeRenderers,
    rendererSnapshot,
    rendererSnapshot,
  );
  const renderer = selectChatRenderer(kind, data, snapshot);
  const ranges = useContext(SyntaxRangesContext);
  const Builtin = builtin;
  const fallback = <Builtin data={data} DefaultRenderer={NoDefault} />;
  if (!renderer) return fallback;
  const Custom = renderer.component;
  return (
    <SyntaxRangesContext.Provider
      value={ranges && isBuiltinChatRenderer(renderer)}
    >
      <SavedOutputContext.Provider value={false}>
        <BuiltinContext.Provider value={fallback}>
          <ChatRendererBoundary
            key={`${snapshot.generation}:${renderer.id}:${contentKey}`}
            fallback={fallback}
            rendererId={renderer.id}
            generation={snapshot.generation}
          >
            <Custom data={data} DefaultRenderer={DefaultRenderer} />
          </ChatRendererBoundary>
        </BuiltinContext.Provider>
      </SavedOutputContext.Provider>
    </SyntaxRangesContext.Provider>
  );
}
