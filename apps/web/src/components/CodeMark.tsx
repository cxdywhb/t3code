import type { ComponentProps } from "react";

import icon from "../../../../assets/code/icon-180.png";

export function CodeMark(props: ComponentProps<"img">) {
  return <img {...props} src={icon} alt="" />;
}
