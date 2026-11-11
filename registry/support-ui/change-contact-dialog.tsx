"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSupport } from "./provider";
import type { TicketDetail } from "./client";

/** Makes someone else the ticket's contact, such as the customer when a teammate's email opened it. */
export function ChangeContactDialog({
  detail,
  open,
  onOpenChange,
}: {
  detail: TicketDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { client, t } = useSupport();
  const queryClient = useQueryClient();
  const [address, setAddress] = useState("");
  const change = useMutation({
    mutationFn: () => client.changeContact({ ticketId: detail.ticket.id, address: address.trim() }),
    onSuccess: () => {
      onOpenChange(false);
      setAddress("");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["support", "ticket", detail.ticket.id] });
      queryClient.invalidateQueries({ queryKey: ["support", "tickets"] });
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) change.reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("contact.title")}</DialogTitle>
          <DialogDescription>{t("contact.description")}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (address.trim()) change.mutate();
          }}
        >
          <Input
            autoFocus
            type="email"
            dir="ltr"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder={t("composer.ccPlaceholder")}
            aria-label={t("contact.email")}
          />
          {change.error && (
            <p className="text-sm text-destructive">{change.error instanceof Error && change.error.message ? change.error.message : t("errors.send")}</p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("actions.cancel")}
            </Button>
            <Button type="submit" disabled={!address.trim() || change.isPending}>
              {change.isPending && <Loader2 className="size-4 animate-spin" />}
              {t("contact.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
