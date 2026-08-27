import { create } from "zustand";

/**
 * sceneStore — 全局共享数据层（模型/场景数据按身份全局共享一份）。
 * 网格对象、物体变换、选择集等由所有 3D 视图 area 共享一份：一个视图里改，
 * 其它视图同步反映（数据按"身份"共享，而非按 area）。
 */
/** 共享网格对象：全部视口面板读到的同一份数据
 * @category 共享场景
 */
export interface MeshObject { x: number; rot: number; }

export interface SceneState {
  mesh: MeshObject;
}

export const useScene = create<SceneState>(() => ({
  mesh: { x: 0, rot: 0 },
}));

/** 共享场景命令(非 hook，可在任意处调用)
 * @category 共享场景
 */
export const sceneActions = {
  /** 移动物体：全局共享，任何视图操作都改变所有视图看到的同一模型
   *  @param dx x 方向位移量 */
  moveMesh(dx: number): void {
    useScene.setState((s) => ({ mesh: { ...s.mesh, x: s.mesh.x + dx } }));
  },
  /** 旋转物体：同样全局共享
   *  @param dr 旋转增量 */
  rotMesh(dr: number): void {
    useScene.setState((s) => ({ mesh: { ...s.mesh, rot: s.mesh.rot + dr } }));
  },
};