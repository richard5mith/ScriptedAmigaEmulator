; GPL-2.0-or-later. Position-independent 68000 code emitted by SAEF_WHDLoad.flushProgram().
; Flush DH0 synchronously after WHDLoad disk I/O. No Intuition calls.
; DoPkt ACTION_FLUSH writes pending filesystem buffers before returning to the game.
; Packet reference: https://wiki.amigaos.net/wiki/AmigaDOS_Packets
; DOS LVOs: https://amigadev.elowar.com/read/ADCD_2.1/Includes_and_Autodocs_2._guide/node0550.html
; If a handler does not support it, keep WHDLoad's original 150-tick safety delay.
        movem.l d2-d7/a2-a6,-(sp)
        movea.l 4.w,a6
        lea     dosname(pc),a1
        moveq   #37,d0
        jsr     -552(a6)               ; exec.OpenLibrary
        tst.l   d0
        beq.w   failed
        movea.l d0,a6
        lea     device(pc),a0
        move.l  a0,d1
        jsr     -174(a6)               ; dos.DeviceProc
        move.l  d0,d1
        beq.w   delay
        moveq   #27,d2                 ; ACTION_FLUSH
        moveq   #0,d3
        moveq   #0,d4
        moveq   #0,d5
        moveq   #0,d6
        moveq   #0,d7
        jsr     -240(a6)               ; dos.DoPkt
        tst.l   d0
        bne.w   close
 delay: move.l  #150,d1
        jsr     -198(a6)               ; dos.Delay
 close: movea.l a6,a1
        movea.l 4.w,a6
        jsr     -414(a6)               ; exec.CloseLibrary
        moveq   #0,d0
        bra.w   done
 failed:moveq   #20,d0
 done:  movem.l (sp)+,d2-d7/a2-a6
        rts
 dosname: dc.b 'dos.library',0
 device:  dc.b 'DH0:',0
        even
