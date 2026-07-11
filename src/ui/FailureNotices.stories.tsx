import type { Meta, StoryObj } from "@storybook/react-vite";
import { CreditFailurePopup, PsuFailureModal } from "./FailureNotices";

const meta = {
  title: "UI/Notices/FailureNotices",
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const PsuFailureDialog: Story = {
  render: () => <PsuFailureModal onDismiss={() => undefined} />,
};

export const FirstCreditFailureDialog: Story = {
  render: () => (
    <CreditFailurePopup firstTime onDismiss={() => undefined} />
  ),
};

export const LaterCreditFailureDialog: Story = {
  render: () => (
    <CreditFailurePopup firstTime={false} onDismiss={() => undefined} />
  ),
};
