import { beforeEach, describe, expect, it } from "vitest";
import { sceneActions, useScene } from "../src/sceneStore";

beforeEach(() => useScene.setState({ mesh: { x: 0, rot: 0 } }));

describe("sceneStore 共享场景操作", () => {
  it("moveMesh 全局移动物体位置", () => {
    sceneActions.moveMesh(1.5);
    expect(useScene.getState().mesh.x).toBe(1.5);
    sceneActions.moveMesh(-0.5);
    expect(useScene.getState().mesh.x).toBe(1);
  });
  it("rotMesh 全局旋转物体", () => {
    sceneActions.rotMesh(30);
    expect(useScene.getState().mesh.rot).toBe(30);
    sceneActions.rotMesh(15);
    expect(useScene.getState().mesh.rot).toBe(45);
  });
});
