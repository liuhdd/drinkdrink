import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function GuandanRules({ open, onOpenChange, description, persistence }: { open: boolean; onOpenChange: (open: boolean) => void; description: string; persistence: string }) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent id="guandan-rules-dialog" data-appearance-region="guandan" className="max-h-[85dvh] overflow-y-auto"><DialogHeader><DialogTitle>掼蛋规则</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
    <div className="space-y-4 text-sm leading-6">
      <div><h3 className="font-semibold">出牌与配牌</h3><p>两副牌共 108 张，每人 27 张。从 2 开始打级，级牌大于 A、小于小王；大王最大。红桃级牌是百搭，可替代除大小王外的牌。同类牌型、相同张数才能比较，炸弹可压普通牌。</p></div>
      <div><h3 className="font-semibold">支持的牌型</h3><p>单张、对子、三张、三带二、5 张顺子、3 连对、2 连三张（钢板）、4 张及以上同点炸弹、5 张同花顺、四王炸。顺子支持 A2345 和 10JQKA，不能跨过 A 循环；级牌参与顺子时仍按原点数计算。</p></div>
      <div><h3 className="font-semibold">炸弹大小</h3><p>同点炸弹先比张数，再比点数。同花顺大于五张炸弹、小于六张炸弹；同花顺之间比最大点数。四王炸最大。</p></div>
      <div><h3 className="font-semibold">不出与接风</h3><p>轮到你时点选手牌，再出牌；可用「提示」选出一组合法牌，再次点击可循环切换。跟牌可以选择不出，领出时不能不出。其他在场玩家都不出后，上一手玩家重新领出；若已出完，由仍有牌的对家接风。</p></div>
      <div><h3 className="font-semibold">结算、升级与进贡</h3><p>先出完者是头游。头游与对家分别为一二名、第一三名、第一四名时，获胜方升 3、2、1 级。打 A 时须头游且对家不是末游才能通关。下一局自动执行进贡、退贡与抗贡。进贡不交百搭牌，优先自动退最小的、不超过 10 的非级牌；没有此类牌时退最小非百搭牌。</p></div>
      <div><h3 className="font-semibold">本工具的规则约定</h3><p>双下立即结算，未出完的两家按轮转座位补名次；同值双贡按座位序分配，进贡较大者先出。抗贡时头游先出。打 A 失败仍留在 A，不采用“三次失败退回 2”的地方变体。</p></div>
      <p className="text-xs text-muted-foreground">{persistence} 与酒局账本独立，不自动记酒或加罚酒。</p>
    </div>
  </DialogContent></Dialog>;
}
