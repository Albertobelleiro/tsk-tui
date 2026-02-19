import { useState, useEffect } from "react";
import type { ReactNode } from "react";
import { colors } from "../theme/colors.ts";

interface ModalProps {
  title: string;
  children: ReactNode;
  width?: number;
  onClose: () => void;
}

export function Modal({ title, children, width = 50 }: ModalProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 16);
    return () => clearTimeout(timer);
  }, []);

  return (
    <box
      flexGrow={1}
      justifyContent="center"
      alignItems="center"
      position="absolute"
      top={0}
      left={0}
      right={0}
      bottom={0}
      backgroundColor={colors.bgDark}
      opacity={visible ? 1 : 0}
    >
      <box
        flexDirection="column"
        width={width}
        backgroundColor={colors.bgModal}
        borderStyle="single"
        borderColor={colors.borderFocus}
        border={true}
        title={title}
        paddingLeft={1}
        paddingRight={1}
        paddingTop={1}
        paddingBottom={1}
      >
        {children}
      </box>
    </box>
  );
}
