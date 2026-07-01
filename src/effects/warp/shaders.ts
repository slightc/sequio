/**
 * Shared GLSL scaffolding for the custom warp filters (bulge / perspective).
 *
 * These are WebGL-only (`glProgram`) — the compositor runs WebGL (contract #3
 * uses one render core) and the e2e verifies on WebGL. WGSL variants for the
 * WebGPU path are a follow-up (see `todo/07`).
 */
import { Filter, GlProgram, UniformGroup } from 'pixi.js';

/**
 * PixiJS's default filter vertex shader, inlined (it is not a public export).
 * Emits `vTextureCoord` (sample coord into `uTexture`) and consumes the system
 * uniforms `uInputSize` / `uOutputFrame` / `uOutputTexture` the FilterSystem
 * supplies to every filter.
 */
export const DEFAULT_FILTER_VERT = `in vec2 aPosition;
out vec2 vTextureCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition( void )
{
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0*uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord( void )
{
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main(void)
{
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
}`;

/**
 * Build a WebGL-only {@link Filter} from a fragment shader + one uniform group.
 * The fragment may use the system uniforms `uTexture`, `uInputClamp` and
 * `uInputSize` (supplied by the FilterSystem) plus the group's own uniforms.
 */
export function makeGlFilter(name: string, fragment: string, uniforms: UniformGroup): Filter {
  return new Filter({
    glProgram: GlProgram.from({ vertex: DEFAULT_FILTER_VERT, fragment, name }),
    resources: { warpUniforms: uniforms },
  });
}
