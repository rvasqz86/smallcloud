import { expect, it } from "vitest";
import { SERVICE_NAME } from "./index.js";

it("exposes the service name", () => {
  expect(SERVICE_NAME).toBe("smallcloud-control-plane");
});
