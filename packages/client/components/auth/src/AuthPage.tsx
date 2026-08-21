import { JSX } from "solid-js";

import { styled } from "styled-system/jsx";

import { Titlebar } from "@revolt/app/interface/desktop/Titlebar";

import { FlowBase } from "./flows/Flow";

/**
 * Authentication page layout
 */
const Base = styled("div", {
  base: {
    width: "100%",
    height: "100%",
    padding: "40px 35px",

    userSelect: "none",
    overflowY: "scroll",

    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",

    mdDown: {
      padding: "30px 20px",
    },
  },
});

const Root = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    paddingBottom: "env(keyboard-inset-height)",

    color: "#f3efe6",
    background: "#141210",

    "& a": {
      color: "#8a8378",
    },
  },
});

/**
 * Top and bottom navigation bars
 */
const Nav = styled("div", {
  base: {
    height: "32px",
    display: "flex",
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",

    textDecoration: "none",
  },
});

/**
 * Authentication page
 */
export function AuthPage(props: { children: JSX.Element }) {
  return (
    <Root
      style={{
        "--md-sys-color-surface": "#141210",
        "--md-sys-color-on-surface": "#f3efe6",
        "--md-sys-color-surface-container": "#1c1a17",
        "--md-sys-color-primary": "#e85a2a",
        "--md-sys-color-on-primary": "#141210",
        "--md-sys-color-secondary-container": "#2b2926",
        "--md-sys-color-on-secondary-container": "#f3efe6",
      }}
    >
      <Titlebar />
      <Base css={{ scrollbar: "hidden" }}>
        <Nav>
          <div />
        </Nav>
        <FlowBase>{props.children}</FlowBase>
        <Nav>
          <a href="https://muhbianco.com.br" target="_blank" rel="noreferrer">
            muhbianco.com.br
          </a>
        </Nav>
      </Base>
    </Root>
  );
}
