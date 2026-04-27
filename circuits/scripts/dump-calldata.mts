import * as snarkjs from 'snarkjs'
import * as h3 from 'h3-js'
import {
  buildCoverageMerkleTree, proveMembership, h3StringToBigint, encodePolicyId,
} from '../../packages/privacy-creds/src/h3-merkle'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const WASM = `${ROOT}/build/geo-h3-inclusion/geo-h3-inclusion_js/geo-h3-inclusion.wasm`
const ZKEY = `${ROOT}/build/geo-h3-inclusion/geo-h3-inclusion_final.zkey`

const parentRes6 = h3.latLngToCell(40.05, -105.05, 6)
const childRes8 = h3.cellToChildren(parentRes6, 8)[0]
const cells = h3.gridDisk(parentRes6, 1).slice(0, 4)
const tree = await buildCoverageMerkleTree(cells, 16)
const proof = await proveMembership(tree, parentRes6)

const witness = {
  coverageRoot: tree.root.toString(),
  featureVersion: '1',
  policyId: encodePolicyId('smart-agent.geo-overlap.v1').toString(),
  h3CellRes8: h3StringToBigint(childRes8).toString(),
  h3ParentRes6: h3StringToBigint(parentRes6).toString(),
  merklePath: proof.path.map(s => s.toString()),
  merkleIndices: proof.pathIndices.map(String),
}
const { proof: zkp, publicSignals } = await snarkjs.groth16.fullProve(witness, WASM, ZKEY)
const cd: string = await snarkjs.groth16.exportSolidityCallData(zkp, publicSignals)
process.stdout.write(cd)
