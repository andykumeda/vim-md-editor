import { TooltipProvider } from "@/components/ui/tooltip";
import EditorPage from "@/pages/editor";

function App() {
  return (
    <TooltipProvider>
      <EditorPage />
    </TooltipProvider>
  );
}

export default App;
