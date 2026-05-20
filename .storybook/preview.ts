import type { Preview } from "@storybook/react-vite";
import "../src/ui/styles.css";

const preview: Preview = {
  parameters: {
    controls: {
      expanded: true,
    },
    layout: "fullscreen",
  },
};

export default preview;
